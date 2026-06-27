import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const filePath = join(__dirname, '..', 'node_modules', '@capacitor', 'android', 'capacitor', 'src', 'main', 'java', 'com', 'getcapacitor', 'WebViewLocalServer.java');

try {
  let content = readFileSync(filePath, 'utf8');
  const oldCode = `            mimeType = URLConnection.guessContentTypeFromName(path); // Does not recognize *.js
            if (mimeType != null && path.endsWith(".js") && mimeType.equals("image/x-icon")) {
                Logger.debug("We shouldn't be here");
            }
            if (mimeType == null) {
                if (path.endsWith(".js") || path.endsWith(".mjs")) {
                    // Make sure JS files get the proper mimetype to support ES modules
                    mimeType = "application/javascript";
                } else if (path.endsWith(".wasm")) {
                    mimeType = "application/wasm";
                } else {
                    mimeType = URLConnection.guessContentTypeFromStream(stream);
                }
            }`;
  const newCode = `            if (path.endsWith(".js") || path.endsWith(".mjs")) {
                mimeType = "application/javascript";
            } else if (path.endsWith(".wasm")) {
                mimeType = "application/wasm";
            } else {
                mimeType = URLConnection.guessContentTypeFromName(path);
                if (mimeType == null) {
                    mimeType = URLConnection.guessContentTypeFromStream(stream);
                }
            }`;
  if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    writeFileSync(filePath, content, 'utf8');
    console.log('Patched WebViewLocalServer.java — .js/.mjs files now get application/javascript MIME type');
  } else if (content.includes(newCode)) {
    console.log('WebViewLocalServer.java already patched');
  } else {
    console.warn('Could not find the target code in WebViewLocalServer.java. Manual patching needed.');
  }
} catch (err) {
  console.error('Failed to patch WebViewLocalServer.java:', err.message);
}
