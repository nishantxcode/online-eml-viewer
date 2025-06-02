// EML Parser Class
class EMLParser {
    constructor() {
        this.boundaries = [];
        this.attachments = [];
        this.inlineImages = new Map();
        this.headers = {};
    }

    // Parse the entire EML file
    async parse(file) {
        try {
            const content = await this.readFile(file);
            const headerBodySeparator = '\r\n\r\n';
            const separatorIndex = content.indexOf(headerBodySeparator);
            
            if (separatorIndex === -1) {
                throw new Error('Invalid email format');
            }

            const headerContent = content.substring(0, separatorIndex);
            const bodyContent = content.substring(separatorIndex + headerBodySeparator.length);

            this.parseHeaders(headerContent);
            
            const contentType = this.headers['content-type'] || '';
            const boundaryMatch = contentType.match(/boundary="?([^";\s]+)"?/);
            
            if (boundaryMatch) {
                this.boundaries.push(boundaryMatch[1]);
            }

            await this.parseBody(bodyContent);

            return {
                headers: this.headers,
                body: this.processedBody,
                attachments: this.attachments,
                inlineImages: this.inlineImages
            };
        } catch (error) {
            throw error;
        }
    }

    // Read file content as text
    async readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    // Parse email headers
    parseHeaders(headerContent) {
        const headerLines = headerContent.split(/\r?\n/);
        let currentHeader = '';
        let currentValue = '';

        for (let line of headerLines) {
            if (line.match(/^\s/)) {
                currentValue += ' ' + line.trim();
            } else {
                if (currentHeader) {
                    this.headers[currentHeader] = this.decodeMIMEHeader(currentValue);
                }

                const match = line.match(/^([\w-]+):\s*(.*)$/i);
                if (match) {
                    currentHeader = match[1].toLowerCase();
                    currentValue = match[2];
                }
            }
        }

        if (currentHeader) {
            this.headers[currentHeader] = this.decodeMIMEHeader(currentValue);
        }
    }

    // Decode MIME encoded headers
    decodeMIMEHeader(text) {
        return text.replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/g, (match, charset, encoding, content) => {
            if (encoding.toUpperCase() === 'B') {
                return atob(content);
            } else if (encoding.toUpperCase() === 'Q') {
                return content
                    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
                    .replace(/_/g, ' ');
            }
            return content;
        });
    }

    // Parse email body and attachments
    async parseBody(content) {
        if (this.boundaries.length > 0) {
            const parts = this.splitMultipart(content);
            let htmlBody = '';
            let textBody = '';

            for (const part of parts) {
                if (!part.trim()) continue;

                const { headers: partHeaders, body: partContent } = this.parsePartHeaders(part);

                if (!partHeaders['content-type']) continue;

                if (partHeaders['content-type'].startsWith('text/html')) {
                    htmlBody = await this.decodeContent(partContent, partHeaders);
                } else if (partHeaders['content-type'].startsWith('text/plain')) {
                    textBody = await this.decodeContent(partContent, partHeaders);
                } else if (this.isAttachment(partHeaders)) {
                    await this.processAttachment(partHeaders, partContent);
                }
            }

            this.processedBody = htmlBody || this.convertPlainTextToHtml(textBody);
        } else {
            const contentType = this.headers['content-type'] || 'text/plain';
            const encoding = this.headers['content-transfer-encoding'];

            const decodedContent = await this.decodeContent(content, {
                'content-type': contentType,
                'content-transfer-encoding': encoding
            });

            this.processedBody = contentType.startsWith('text/html') 
                ? decodedContent 
                : this.convertPlainTextToHtml(decodedContent);
        }
    }

    // Split multipart content
    splitMultipart(content) {
        const boundary = this.boundaries[0];
        if (!boundary) return [content];

        const regex = new RegExp(`--${boundary}(?:--)?[\r\n]*`, 'g');
        const splitParts = content.split(regex);
        return splitParts.filter(part => part.trim().length > 0);
    }

    // Parse headers for each part
    parsePartHeaders(part) {
        const headers = {};
        const lines = part.split(/\r?\n/);
        let currentHeader = '';
        let currentValue = '';
        let i = 0;

        // Parse headers until empty line
        for (; i < lines.length; i++) {
            const line = lines[i];
            if (line === '') break;

            if (line.match(/^\s/)) {
                currentValue += ' ' + line.trim();
            } else {
                if (currentHeader) {
                    headers[currentHeader] = currentValue.trim();
                }

                const match = line.match(/^([\w-]+):\s*(.*)$/i);
                if (match) {
                    currentHeader = match[1].toLowerCase();
                    currentValue = match[2];
                }
            }
        }

        // Save last header
        if (currentHeader) {
            headers[currentHeader] = currentValue.trim();
        }

        // Get the body part
        const body = lines.slice(i + 1).join('\n');
        return { headers, body };
    }

    // Check if part is an attachment
    isAttachment(headers) {
        return headers['content-disposition']?.includes('attachment') ||
               (headers['content-type']?.includes('application/') && headers['content-transfer-encoding'] === 'base64');
    }

    // Process attachment
    async processAttachment(headers, content) {
        const filename = this.getFilename(headers);
        if (!filename) return;

        const contentType = headers['content-type']?.split(';')[0] || 'application/octet-stream';
        const isInline = headers['content-id'] || headers['content-disposition']?.includes('inline');
        const cleanContent = content.replace(/[^A-Za-z0-9+/=]/g, '');

        if (isInline && contentType.startsWith('image/')) {
            const contentId = headers['content-id']?.replace(/[<>]/g, '') ||
                            `inline-${this.inlineImages.size + 1}`;
            this.inlineImages.set(contentId, `data:${contentType};base64,${cleanContent}`);
        } else {
            this.attachments.push({
                filename,
                contentType,
                size: this.calculateSize(cleanContent),
                content: cleanContent
            });
        }
    }

    // Get filename from headers
    getFilename(headers) {
        const dispositionMatch = headers['content-disposition']?.match(/filename="?([^"]+)"?/);
        const typeMatch = headers['content-type']?.match(/name="?([^"]+)"?/);
        return dispositionMatch?.[1] || typeMatch?.[1];
    }

    // Calculate file size
    calculateSize(base64Content) {
        const padding = base64Content.endsWith('==') ? 2 : base64Content.endsWith('=') ? 1 : 0;
        const size = (base64Content.length * 3) / 4 - padding;
        
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    // Decode content based on transfer encoding
    async decodeContent(content, headers) {
        const encoding = headers['content-transfer-encoding']?.toLowerCase();
        let decoded = content;

        if (encoding === 'base64') {
            try {
                const cleanContent = content.replace(/[^A-Za-z0-9+/=]/g, '');
                decoded = atob(cleanContent);
            } catch (error) {
                throw new Error('Failed to decode base64 content');
            }
        } else if (encoding === 'quoted-printable') {
            decoded = decoded.replace(/=\r?\n/g, '')
                           .replace(/=([0-9A-F]{2})/gi, (_, hex) => 
                               String.fromCharCode(parseInt(hex, 16)));
        }

        // Handle charset
        const charsetMatch = headers['content-type']?.match(/charset="?([^";]+)"?/i);
        const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8';
        
        if (charset && charset !== 'utf-8') {
            try {
                const decoder = new TextDecoder(charset);
                const bytes = new Uint8Array(decoded.split('').map(c => c.charCodeAt(0)));
                decoded = decoder.decode(bytes);
            } catch (e) {
                // Fallback to original content if charset conversion fails
            }
        }

        return decoded;
    }

    // Convert plain text to HTML
    convertPlainTextToHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/\n/g, '<br>')
            .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    }
}

// UI Handler Class
class UIHandler {
    constructor() {
        this.parser = new EMLParser();
        this.initializeElements();
        this.setupEventListeners();
    }

    // Initialize DOM elements
    initializeElements() {
        this.dropZone = document.getElementById('dropZone');
        this.fileInput = document.getElementById('fileInput');
        this.browseButton = document.getElementById('browseButton');
        this.showMailButton = document.getElementById('showMailButton');
        this.emailDisplay = document.getElementById('emailDisplay');
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.errorMessage = document.getElementById('errorMessage');
        this.errorText = document.getElementById('errorText');
        this.dismissError = document.getElementById('dismissError');
        this.selectedFileInfo = document.getElementById('selectedFileInfo');
        this.selectedFileName = document.getElementById('selectedFileName');
        this.currentFile = null;
    }

    // Setup event listeners
    setupEventListeners() {
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('drag-over');
        });

        this.dropZone.addEventListener('dragleave', () => {
            this.dropZone.classList.remove('drag-over');
        });

        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) this.handleFiles(files);
        });

        this.browseButton.addEventListener('click', () => {
            this.fileInput.click();
        });

        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this.handleFiles(e.target.files);
        });

        this.showMailButton.addEventListener('click', () => {
            this.handleShowMail();
        });

        this.dismissError.addEventListener('click', () => {
            this.errorMessage.classList.add('hidden');
        });
    }

    // Handle file processing
    async handleFiles(files) {
        for (const file of files) {
            if (!file.name.toLowerCase().endsWith('.eml')) {
                this.showError('Please select a valid .eml file');
                this.hideFileInfo();
                continue;
            }

            try {
                this.currentFile = file;
                this.showFileInfo(file.name);
                this.showError('File loaded successfully. Click "Show Mail" to view the content.');
            } catch (error) {
                this.showError('Error loading file: ' + error.message);
                this.currentFile = null;
                this.hideFileInfo();
            }
        }
    }

    // Show file info
    showFileInfo(fileName) {
        this.selectedFileName.textContent = fileName;
        this.selectedFileInfo.classList.remove('hidden');
    }

    // Hide file info
    hideFileInfo() {
        this.selectedFileInfo.classList.add('hidden');
        this.selectedFileName.textContent = '';
    }

    // Handle show mail button click
    async handleShowMail() {
        if (!this.currentFile) {
            this.showError('Please browse and select an EML file first');
            return;
        }

        try {
            this.showLoading();
            const result = await this.parser.parse(this.currentFile);
            this.displayEmail(result);
        } catch (error) {
            this.showError('Error processing email: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    // Display email content
    displayEmail(result) {
        // Clear any existing content first
        document.getElementById('emailSubject').textContent = '';
        document.getElementById('emailFrom').textContent = '';
        document.getElementById('emailTo').textContent = '';
        document.getElementById('emailDate').textContent = '';
        document.getElementById('emailCC').textContent = '';
        document.getElementById('emailBody').innerHTML = '';

        // Make sure the email display section is visible
        this.emailDisplay.classList.remove('hidden');
        
        // Display headers
        document.getElementById('emailSubject').textContent = result.headers.subject || '';
        document.getElementById('emailFrom').textContent = result.headers.from || '';
        document.getElementById('emailTo').textContent = result.headers.to || '';
        document.getElementById('emailDate').textContent = result.headers.date || '';
        document.getElementById('emailCC').textContent = result.headers.cc || '';

        // Process and display body
        let bodyContent = result.body;
        if (result.inlineImages && result.inlineImages.size > 0) {
            result.inlineImages.forEach((dataUrl, contentId) => {
                bodyContent = bodyContent.replace(
                    new RegExp(`cid:${contentId}`, 'g'),
                    dataUrl
                );
            });
        }

        // Set the email body content
        const emailBody = document.getElementById('emailBody');
        emailBody.innerHTML = bodyContent || 'No content available';

        // Handle attachments
        const attachmentsSection = document.getElementById('attachmentsSection');
        const attachmentsList = document.getElementById('attachmentsList');
        
        // Clear existing attachments
        attachmentsList.innerHTML = '';

        if (result.attachments && result.attachments.length > 0) {
            attachmentsSection.classList.remove('hidden');
            result.attachments.forEach(attachment => {
                const item = this.createAttachmentItem(attachment);
                attachmentsList.appendChild(item);
            });
        } else {
            attachmentsSection.classList.add('hidden');
        }

        // Scroll the email display into view
        this.emailDisplay.scrollIntoView({ behavior: 'smooth' });
    }

    // Create attachment item element
    createAttachmentItem(attachment) {
        const item = document.createElement('div');
        item.className = 'attachment-item';
        
        const icon = document.createElement('i');
        icon.className = 'fas fa-paperclip';
        
        const info = document.createElement('div');
        info.className = 'attachment-info';
        info.textContent = `${attachment.filename} (${attachment.size})`;
        
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'download-button';
        downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download';
        downloadBtn.onclick = () => this.downloadAttachment(attachment);
        
        item.appendChild(icon);
        item.appendChild(info);
        item.appendChild(downloadBtn);
        
        return item;
    }

    // Handle attachment download
    downloadAttachment(attachment) {
        const blob = new Blob(
            [Uint8Array.from(atob(attachment.content), c => c.charCodeAt(0))],
            { type: attachment.contentType }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = attachment.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Show loading overlay
    showLoading() {
        this.loadingOverlay.classList.remove('hidden');
    }

    // Hide loading overlay
    hideLoading() {
        this.loadingOverlay.classList.add('hidden');
    }

    // Show error message
    showError(message) {
        this.errorText.textContent = message;
        this.errorMessage.classList.remove('hidden');
        if (message.includes('successfully')) {
            this.errorMessage.style.background = '#27ae60';
        } else {
            this.errorMessage.style.background = '#ff4757';
        }
        setTimeout(() => {
            this.errorMessage.classList.add('hidden');
        }, 5000);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new UIHandler();
}); 