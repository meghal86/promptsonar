const fs = require('fs');

// Tiny 1x1 transparent PNG base64
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const buffer = Buffer.from(pngBase64, 'base64');

fs.writeFileSync('icon.png', buffer);
fs.writeFileSync('screenshot-cli-fail.png', buffer);
fs.writeFileSync('screenshot-vscode-squiggles.png', buffer);
console.log("Dummy images created.");
