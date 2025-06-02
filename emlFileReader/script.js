class EMLParser {
    constructor() {
        this.setupEventListeners();
        this.showLoading = this.showLoading.bind(this);
        this.hideLoading = this.hideLoading.bind(this);
        this.debugMode = true;
    }

    setupEventListeners() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');

        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
        uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
        uploadArea.addEventListener('drop', this.handleDrop.bind(this));
        fileInput.addEventListener('change', this.handleFileSelect.bind(this));
    }

    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('dragover');
        const files = e.dataTransfer.files;
        this.processFiles(files);
    }

    handleFileSelect(e) {
        const files = e.target.files;
        this.processFiles(files);
    }

    async processFiles(files) {
        if (files.length === 0) return;
        
        this.showLoading();
        
        try {
            for (let file of files) {
                if (file.name.toLowerCase().endsWith('.eml')) {
                    console.log('Processing file:', file.name);
                    const content = await this.readFile(file);
                    console.log('File content length:', content.length);
                    await this.parseEML(content, file.name);
                    break;
                }
            }
        } catch (error) {
            console.error('Error processing files:', error);
            this.showError('Error processing the EML file. Please try again.');
        } finally {
            this.hideLoading();
        }
    }

    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    async parseEML(emlContent, fileName) {
        console.log('=== STARTING EML PARSING ===');
        
        // Normalize line endings
        emlContent = emlContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        const headerEndIndex = emlContent.indexOf('\n\n');
        
        if (headerEndIndex === -1) {
            console.error('Invalid EML format: No header-body separator found');
            this.showError('Invalid EML file format');
            return;
        }

        const headerSection = emlContent.substring(0, headerEndIndex);
        const bodySection = emlContent.substring(headerEndIndex + 2);

        const headers = this.parseHeaders(headerSection);
        const contentType = headers['Content-Type'] || '';
        const boundary = this.extractBoundary(contentType);
        
        let body = '';
        let attachments = [];
        let inlineImages = new Map();
        let debugInfo = [];
        
        if (boundary) {
            console.log('Multipart email detected, boundary:', boundary);
            debugInfo.push(`Multipart email with boundary: ${boundary}`);
            const parts = this.parseMultipartContent(bodySection, boundary);
            body = parts.body;
            attachments = parts.attachments;
            inlineImages = parts.inlineImages;
            debugInfo = debugInfo.concat(parts.debugInfo);
        } else {
            console.log('Simple email detected');
            debugInfo.push('Simple (non-multipart) email');
            body = bodySection;
        }
        
        if (!body || body.trim() === '') {
            body = bodySection;
            debugInfo.push('Using entire body section as fallback');
        }
        
        // Extract embedded images from HTML content
        console.log('Checking for embedded images in HTML...');
        const embeddedImages = this.extractEmbeddedImages(body);
        if (embeddedImages.length > 0) {
            debugInfo.push(`Found ${embeddedImages.length} embedded base64 images in HTML`);
            embeddedImages.forEach((img, index) => {
                inlineImages.set(`embedded_${index}`, {
                    contentType: img.mimeType,
                    data: img.data,
                    encoding: 'base64',
                    partIndex: 'embedded_in_html'
                });
            });
        }
        
        console.log('=== PARSING COMPLETE ===');
        console.log('Body length:', body.length);
        console.log('Inline images found:', inlineImages.size);
        console.log('Attachments found:', attachments.length);
        
        this.displayEmail(headers, body, attachments, fileName, inlineImages, debugInfo);
    }

    extractEmbeddedImages(htmlContent) {
        const embeddedImages = [];
        
        console.log('Searching for embedded images in HTML content...');
        
        // Look for data: URLs in img src attributes
        const dataUrlPattern = /<img[^>]+src\s*=\s*["']data:([^;]+);base64,([^"']+)["'][^>]*>/gi;
        let match;
        
        while ((match = dataUrlPattern.exec(htmlContent)) !== null) {
            console.log(`Found embedded image: ${match[1]}`);
            embeddedImages.push({
                mimeType: match[1],
                data: match[2]
            });
        }
        
        console.log(`Found ${embeddedImages.length} embedded images in HTML`);
        return embeddedImages;
    }

    parseHeaders(headerSection) {
        const headers = {};
        const lines = headerSection.split('\n');
        let currentHeader = '';
        let currentValue = '';

        for (let line of lines) {
            if (line.match(/^\s/) && currentHeader) {
                currentValue += ' ' + line.trim();
            } else {
                if (currentHeader) {
                    headers[currentHeader] = currentValue.trim();
                }
                
                const colonIndex = line.indexOf(':');
                if (colonIndex > 0) {
                    currentHeader = line.substring(0, colonIndex).trim();
                    currentValue = line.substring(colonIndex + 1).trim();
                } else {
                    currentHeader = '';
                    currentValue = '';
                }
            }
        }
        
        if (currentHeader) {
            headers[currentHeader] = currentValue.trim();
        }

        return headers;
    }

    extractBoundary(contentType) {
        const boundaryMatch = contentType.match(/boundary[=:][\s]*["']?([^"'\s;]+)["']?/i);
        return boundaryMatch ? boundaryMatch[1] : null;
    }

    parseMultipartContent(content, boundary) {
        const debugInfo = [];
        
        // Split by boundary with proper regex escaping
        const boundaryRegex = new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?`, 'g');
        const parts = content.split(boundaryRegex);
        
        let htmlBody = '';
        let textBody = '';
        const attachments = [];
        const inlineImages = new Map();
        
        console.log('Found', parts.length, 'parts in multipart content');
        debugInfo.push(`Found ${parts.length} parts in multipart content`);
        
        parts.forEach((part, index) => {
            if (!part || part.trim() === '' || part.trim() === '--') {
                return;
            }
            
            console.log(`\n--- Processing Part ${index} ---`);
            
            const headerEndIndex = part.indexOf('\n\n');
            
            if (headerEndIndex === -1) {
                console.log(`Part ${index}: No header separator found`);
                debugInfo.push(`Part ${index}: No header separator found`);
                return;
            }
            
            const partHeaderSection = part.substring(0, headerEndIndex);
            const partBody = part.substring(headerEndIndex + 2);
            
            const partHeaders = this.parseHeaders(partHeaderSection);
            const contentType = (partHeaders['Content-Type'] || '').toLowerCase();
            const contentDisposition = (partHeaders['Content-Disposition'] || '').toLowerCase();
            const contentId = partHeaders['Content-ID'] || '';
            const transferEncoding = (partHeaders['Content-Transfer-Encoding'] || '').toLowerCase();
            
            console.log(`Part ${index} Headers:`, {
                'Content-Type': contentType,
                'Content-Disposition': contentDisposition,
                'Content-ID': contentId,
                'Transfer-Encoding': transferEncoding,
                'Body Length': partBody.length
            });
            
            debugInfo.push(`Part ${index}: ${contentType} | ${contentDisposition} | CID: ${contentId} | Body: ${partBody.length} chars`);
            
            // Check if it's body content first (most likely scenario)
            if (contentType.includes('text/html')) {
                htmlBody = partBody.trim();
                console.log(`Part ${index}: Found HTML body (${htmlBody.length} chars)`);
                debugInfo.push(`📄 HTML body found (${htmlBody.length} chars)`);
                
            } else if (contentType.includes('text/plain')) {
                textBody = partBody.trim();
                console.log(`Part ${index}: Found text body (${textBody.length} chars)`);
                debugInfo.push(`📄 Text body found (${textBody.length} chars)`);
            }
            // Check for images
            else if (contentType.startsWith('image/') || 
                     contentDisposition.includes('image') ||
                     (contentType.includes('application/octet-stream') && 
                      contentDisposition.includes('filename') && 
                      /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(contentDisposition))) {
                
                let cleanContentId = contentId.replace(/[<>]/g, '').trim();
                
                if (!cleanContentId && contentDisposition.includes('filename')) {
                    const filenameMatch = contentDisposition.match(/filename[=:][\s]*["']?([^"'\s;]+)["']?/i);
                    if (filenameMatch) {
                        cleanContentId = filenameMatch[1];
                    }
                }
                
                if (!cleanContentId) {
                    cleanContentId = `image_part_${index}`;
                }
                
                let imageData = partBody.trim();
                
                if (transferEncoding === 'base64') {
                    imageData = imageData.replace(/[\n\r\s]/g, '');
                    
                    try {
                        atob(imageData.substring(0, Math.min(100, imageData.length)));
                        
                        inlineImages.set(cleanContentId, {
                            contentType: contentType.split(';')[0].trim() || 'image/jpeg',
                            data: imageData,
                            encoding: transferEncoding,
                            partIndex: index
                        });
                        
                        console.log(`Part ${index}: Added inline image with CID: "${cleanContentId}"`);
                        debugInfo.push(`✓ Added inline image: ${cleanContentId} (${contentType})`);
                    } catch (e) {
                        console.warn(`Part ${index}: Invalid base64 data for image ${cleanContentId}`);
                        debugInfo.push(`✗ Invalid base64 for image: ${cleanContentId}`);
                    }
                }
            }
            // Check for attachments
            else if (contentDisposition.includes('attachment') || 
                    (contentDisposition.includes('inline') && contentDisposition.includes('filename'))) {
                const attachment = this.parseAttachment(partHeaders, partBody);
                if (attachment) {
                    attachments.push(attachment);
                    console.log(`Part ${index}: Added attachment: ${attachment.filename}`);
                    debugInfo.push(`📎 Attachment: ${attachment.filename}`);
                }
            }
            else if (!contentType || contentType.includes('text')) {
                if (!textBody) {
                    textBody = partBody.trim();
                    console.log(`Part ${index}: Using as fallback text body`);
                    debugInfo.push(`📄 Fallback text body (${textBody.length} chars)`);
                }
            }
        });
        
        const body = htmlBody || textBody;
        
        console.log('\n=== MULTIPART PARSING COMPLETE ===');
        console.log('Body type:', htmlBody ? 'HTML' : 'Text');
        console.log('Body length:', body.length);
        console.log('Inline images:', inlineImages.size);
        console.log('Attachments:', attachments.length);
        
        return { body, attachments, inlineImages, debugInfo };
    }

    parseAttachment(headers, content) {
        const contentDisposition = headers['Content-Disposition'] || '';
        const contentType = headers['Content-Type'] || '';
        const contentId = headers['Content-ID'] || '';
        
        const filenameMatch = contentDisposition.match(/filename[=:][\s]*["']?([^"'\s;]+)["']?/i) ||
                             contentType.match(/name[=:][\s]*["']?([^"'\s;]+)["']?/i);
        
        if (!filenameMatch) {
            return null;
        }
        
        const filename = filenameMatch[1];
        const isInline = contentDisposition.includes('inline');
        const transferEncoding = headers['Content-Transfer-Encoding'] || '';
        
        let processedContent = content.trim();
        
        if (transferEncoding.toLowerCase() === 'base64') {
            try {
                processedContent = processedContent.replace(/\s/g, '');
                atob(processedContent.substring(0, 100));
            } catch (e) {
                console.warn('Invalid base64 content for attachment:', filename);
            }
        }
        
        return {
            filename: filename,
            contentType: contentType.split(';')[0].trim(),
            isInline: isInline,
            contentId: contentId.replace(/[<>]/g, ''),
            transferEncoding: transferEncoding,
            content: processedContent,
            size: this.calculateAttachmentSize(processedContent, transferEncoding)
        };
    }

    calculateAttachmentSize(content, encoding) {
        if (encoding.toLowerCase() === 'base64') {
            return Math.floor((content.replace(/\s/g, '').length * 3) / 4);
        }
        return content.length;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    downloadAttachment(attachment) {
        try {
            let blob;
            
            if (attachment.transferEncoding.toLowerCase() === 'base64') {
                const binaryString = atob(attachment.content.replace(/\s/g, ''));
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                blob = new Blob([bytes], { type: attachment.contentType });
            } else {
                blob = new Blob([attachment.content], { type: attachment.contentType });
            }
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = attachment.filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error downloading attachment:', error);
            alert('Error downloading attachment: ' + attachment.filename);
        }
    }

    // NEW METHOD: Decode URL-encoded subjects
    decodeSubject(subject) {
        if (!subject) return subject;
        
        try {
            // Handle MIME encoded-word format like =?UTF-8?Q?...?=
            if (subject.includes('=?') && subject.includes('?=')) {
                return subject.replace(/=\?([^?]+)\?([QqBb])\?([^?]+)\?=/g, (match, charset, encoding, encoded) => {
                    if (encoding.toLowerCase() === 'q') {
                        // Quoted-printable decoding
                        return decodeURIComponent(encoded.replace(/=/g, '%').replace(/_/g, ' '));
                    } else if (encoding.toLowerCase() === 'b') {
                        // Base64 decoding
                        try {
                            return atob(encoded);
                        } catch (e) {
                            return encoded;
                        }
                    }
                    return encoded;
                });
            }
            
            // Handle simple URL encoding
            if (subject.includes('%20') || subject.includes('=20')) {
                return decodeURIComponent(subject.replace(/=20/g, '%20'));
            }
            
            return subject;
        } catch (e) {
            console.warn('Failed to decode subject:', e);
            return subject;
        }
    }

    displayEmail(headers, body, attachments = [], fileName = '', inlineImages = new Map(), debugInfo = []) {
        const emailContent = document.getElementById('emailContent');
        
        console.log('\n=== DISPLAYING EMAIL ===');
        console.log('Inline images available:', inlineImages.size);
        
        // Process inline images in the body BEFORE displaying
        let processedBody = this.processInlineImages(body, inlineImages);
        
        // Decode the subject using the new method
        const decodedSubject = this.decodeSubject(headers['Subject'] || 'No Subject');
        
        // Create inline images preview section
        let inlineImagesHtml = '';
        if (inlineImages.size > 0) {
            const imageItems = Array.from(inlineImages.entries()).map(([cid, imageData]) => {
                const dataUrl = `data:${imageData.contentType};base64,${imageData.data}`;
                return `
                    <div class="inline-image-item">
                        <strong>ID:</strong> ${this.escapeHtml(cid)} | 
                        <strong>Type:</strong> ${this.escapeHtml(imageData.contentType)} |
                        <strong>Source:</strong> ${imageData.partIndex} |
                        <strong>Size:</strong> ${this.formatFileSize(imageData.data.length)}
                        <br>
                        <img src="${dataUrl}" alt="Inline Image" class="inline-image-preview" />
                    </div>
                `;
            }).join('');
            
            inlineImagesHtml = `
                <div class="inline-images-section">
                    <h3>Images Found (${inlineImages.size})</h3>
                    <div class="inline-images-list">
                        ${imageItems}
                    </div>
                </div>
            `;
        }
        
        // Create debug section
        let debugHtml = '';
        if (this.debugMode && debugInfo.length > 0) {
            debugHtml = `
                <div class="debug-section">
                    <h3>Debug Information</h3>
                    ${debugInfo.map(info => `<div class="debug-item">${this.escapeHtml(info)}</div>`).join('')}
                </div>
            `;
        }
        
        emailContent.innerHTML = `
            <div class="file-info">
                <h2><i class="fas fa-file-alt"></i> ${fileName}</h2>
            </div>
            
            <div class="email-header">
                <h3>Email Information</h3>
                <p><strong>From:</strong> ${this.escapeHtml(headers['From'] || 'Unknown')}</p>
                <p><strong>To:</strong> ${this.escapeHtml(headers['To'] || 'Unknown')}</p>
                <p><strong>Subject:</strong> ${this.escapeHtml(decodedSubject)}</p>
                <p><strong>Date:</strong> ${this.escapeHtml(headers['Date'] || 'Unknown')}</p>
                ${headers['Cc'] ? `<p><strong>CC:</strong> ${this.escapeHtml(headers['Cc'])}</p>` : ''}
                ${headers['Reply-To'] ? `<p><strong>Reply-To:</strong> ${this.escapeHtml(headers['Reply-To'])}</p>` : ''}
            </div>
            
            ${debugHtml}
            
            ${inlineImagesHtml}
            
            ${attachments.length > 0 ? `
                <div class="attachments-section">
                    <h3>Attachments (${attachments.length})</h3>
                    <div class="attachments-list">
                        ${attachments.map((attachment, index) => `
                            <div class="attachment-item" data-index="${index}">
                                <div class="attachment-info">
                                    <span class="attachment-icon">📎</span>
                                    <div class="attachment-details">
                                        <div class="attachment-name">${this.escapeHtml(attachment.filename)}</div>
                                        <div class="attachment-meta">
                                            ${this.formatFileSize(attachment.size)} • ${this.escapeHtml(attachment.contentType)}
                                            ${attachment.isInline ? ' • Inline' : ''}
                                        </div>
                                    </div>
                                </div>
                                <button class="download-btn" onclick="emlParser.downloadAttachment(${this.escapeForJson(attachment)})">
                                    Download
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            <div class="email-body">
                <h3>Message Content</h3>
                <div class="body-content">${this.formatBody(processedBody)}</div>
            </div>
        `;
        
        emailContent.style.display = 'block';
        emailContent.scrollIntoView({ behavior: 'smooth' });
    }

    processInlineImages(body, inlineImages) {
        let processedBody = body;
        
        console.log('\n=== PROCESSING INLINE IMAGES ===');
        console.log('Available inline images:', inlineImages.size);
        
        if (inlineImages.size === 0) {
            console.log('No inline images to process - images should already be embedded in HTML');
            return processedBody;
        }
        
        // Process each inline image for CID references
        inlineImages.forEach((imageData, contentId) => {
            console.log(`Processing image CID: "${contentId}"`);
            
            if (imageData.encoding === 'base64') {
                const dataUrl = `data:${imageData.contentType};base64,${imageData.data}`;
                
                // Create comprehensive patterns to match different cid reference formats
                const patterns = [
                    new RegExp(`cid:${this.escapeRegExp(contentId)}`, 'gi'),
                    new RegExp(`cid:"${this.escapeRegExp(contentId)}"`, 'gi'),
                    new RegExp(`cid:'${this.escapeRegExp(contentId)}'`, 'gi'),
                    new RegExp(`src=["\']cid:${this.escapeRegExp(contentId)}["\']`, 'gi'),
                ];
                
                let totalReplacements = 0;
                patterns.forEach((pattern, patternIndex) => {
                    const beforeReplace = processedBody;
                    processedBody = processedBody.replace(pattern, (match) => {
                        console.log(`Pattern ${patternIndex + 1} matched: "${match}"`);
                        return match.replace(/cid:[^"'\s>]+/, dataUrl);
                    });
                    
                    if (beforeReplace !== processedBody) {
                        const matches = beforeReplace.match(pattern);
                        const replacements = matches ? matches.length : 0;
                        totalReplacements += replacements;
                        console.log(`Pattern ${patternIndex + 1} made ${replacements} replacements`);
                    }
                });
                
                console.log(`Total replacements made for CID "${contentId}": ${totalReplacements}`);
            }
        });
        
        console.log('=== END PROCESSING ===\n');
        return processedBody;
    }

    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    formatBody(body) {
        if (!body || body.trim() === '') {
            return '<p><em>No message content found</em></p>';
        }
        
        if (body.includes('<html>') || body.includes('<HTML>') || 
            body.includes('<body>') || body.includes('<div>') || 
            body.includes('<p>') || body.includes('<br>')) {
            return body;
        } else {
            return `<pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${this.escapeHtml(body)}</pre>`;
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    escapeForJson(obj) {
        return JSON.stringify(obj).replace(/"/g, '&quot;');
    }

    showLoading() {
        document.getElementById('loadingOverlay').style.display = 'flex';
    }

    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    }

    showError(message) {
        const emailContent = document.getElementById('emailContent');
        emailContent.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: #dc3545;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                <h3>Error</h3>
                <p>${message}</p>
                <button onclick="location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #dc3545; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    Try Again
                </button>
            </div>
        `;
        emailContent.style.display = 'block';
    }
}

let emlParser;
document.addEventListener('DOMContentLoaded', () => {
    emlParser = new EMLParser();
    console.log('EML Parser initialized');
});
