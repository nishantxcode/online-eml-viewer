# Online EML Viewer

A professional, secure, and user-friendly web application for viewing EML (Email) files directly in your browser. This application processes all files locally, ensuring your email data remains private and secure.

## Features

- 🔒 100% secure local file processing
- 📧 Complete EML file parsing
- 📎 Attachment handling and downloads
- 🖼️ Inline image support
- 💻 Responsive design for all devices
- 🌐 Multiple file format support
- 🔍 Detailed email header display
- 📝 HTML and plain text email support

## Technical Capabilities

- Parses complex email structures
- Handles multipart email content
- Decodes MIME-encoded headers
- Supports various character encodings
- Processes base64 and quoted-printable content
- Converts inline image references (CID)
- Manages email attachments

## Usage

1. Open `index.html` in a modern web browser
2. Drag and drop your EML file(s) onto the upload area
3. Or click "Browse Files" to select EML files
4. View the parsed email content, including:
   - Email headers (From, To, Subject, Date, CC)
   - Email body (HTML or plain text)
   - Attachments with download options
   - Inline images

## Browser Compatibility

- Google Chrome (recommended)
- Mozilla Firefox
- Microsoft Edge
- Safari
- Other modern browsers with ES6+ support

## Security

- All processing happens in your browser
- No data is sent to any server
- No external dependencies (except Font Awesome for icons)
- Safe file handling and sanitization

## File Structure

```
├── index.html      # Main HTML file
├── styles.css      # CSS styles and animations
├── script.js       # JavaScript with EML parsing logic
└── README.md       # Documentation
```

## Development

The application is built with pure HTML, CSS, and JavaScript, requiring no build process or dependencies. To modify the application:

1. Edit `index.html` for structure changes
2. Modify `styles.css` for styling updates
3. Update `script.js` for functionality changes

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT License - Feel free to use this code in your own projects!

## Credits

- Font Awesome for icons
- Inter font family for typography 