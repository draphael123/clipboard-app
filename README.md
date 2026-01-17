# ClipStash

**Your clipboard history, always within reach.**

ClipStash is a Chrome extension that automatically saves everything you copy, so you never lose important text again.

![ClipStash Preview](landing-page/screenshots/preview.png)

## Features

- 📋 **Unlimited History** - Store up to 100 clips locally
- 🔍 **Instant Search** - Find any clip with fuzzy search
- 📌 **Pin Important Clips** - Keep frequently used snippets accessible
- 🏷️ **Smart Detection** - Auto-tags URLs, code, emails, and phone numbers
- 🔒 **100% Private** - All data stays on your device, no cloud sync
- ⚡ **One-Click Copy** - Click any clip to copy it instantly

## Installation

### From Chrome Web Store (Recommended)
1. Visit the [Chrome Web Store](#) *(coming soon)*
2. Click "Add to Chrome"
3. Done!

### Manual Installation (Developer Mode)
1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/clipstash.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked"
5. Select the `clipstash/extension` folder
6. The ClipStash icon should appear in your toolbar

## Usage

1. **Copy text** anywhere on the web - ClipStash automatically saves it
2. **Click the extension icon** to view your clipboard history
3. **Click any clip** to copy it back to your clipboard
4. **Pin clips** you use frequently by clicking the pin icon
5. **Search clips** using the search button

## Project Structure

```
clipstash/
├── extension/          # Chrome extension
│   ├── manifest.json   # Extension configuration
│   ├── background.js   # Service worker for clipboard storage
│   ├── content.js      # Detects copy events on pages
│   ├── popup.html      # Extension popup UI
│   ├── popup.css       # Popup styles
│   ├── popup.js        # Popup logic
│   └── icons/          # Extension icons
└── landing-page/       # Marketing website
    ├── index.html      # Single-page landing
    ├── favicon.svg     # Site favicon
    └── screenshots/    # Extension screenshots
```

## Development

### Prerequisites
- Google Chrome or Chromium-based browser
- Basic knowledge of Chrome Extensions

### Making Changes
1. Edit files in the `extension/` folder
2. Go to `chrome://extensions/`
3. Click the refresh icon on the ClipStash card
4. Test your changes

### Building Icons
The extension requires PNG icons at 16x16, 32x32, 48x48, and 128x128 pixels. You can generate these from the included `icons/icon.svg`:

```bash
# Using ImageMagick
convert -background none icons/icon.svg -resize 16x16 icons/icon16.png
convert -background none icons/icon.svg -resize 32x32 icons/icon32.png
convert -background none icons/icon.svg -resize 48x48 icons/icon48.png
convert -background none icons/icon.svg -resize 128x128 icons/icon128.png
```

Or use an online tool like [CloudConvert](https://cloudconvert.com/svg-to-png).

## Privacy

ClipStash takes your privacy seriously:
- **No data collection** - We don't collect any personal information
- **No cloud sync** - All clips are stored locally in Chrome storage
- **No analytics** - No tracking or telemetry of any kind
- **Open source** - Full transparency in how the extension works

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

Made with ❤️ for clipboard hoarders everywhere.

