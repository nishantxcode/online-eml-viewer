let selectedFile = null;

document.getElementById('fileInput').addEventListener('change', function (event) {
  selectedFile = event.target.files[0];
});

document.getElementById('showBtn').addEventListener('click', function () {
  const display = document.getElementById('emailDisplay');

  if (!selectedFile) {
    display.innerText = '⚠️ Please select a .eml file first.';
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    const content = e.target.result;

    window.emlformat.read(content, (error, data) => {
      if (error) {
        display.innerText = "❌ Failed to parse .eml file.";
        return;
      }

      const htmlBody = data.html || data.text || "(No content found)";
      display.innerHTML = `
        <strong>From:</strong> ${data.headers.from}<br>
        <strong>To:</strong> ${data.headers.to}<br>
        <strong>Subject:</strong> ${data.headers.subject}<br>
        <strong>Date:</strong> ${data.headers.date}<br>
        <hr>
        <div>${htmlBody}</div>
      `;
    });
  };

  reader.readAsText(selectedFile);
});
