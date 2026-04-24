# Backend

FastAPI backend

## Setup

1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/).

2. Install ExifTool (required system dependency for metadata extraction):
   ```bash
   sudo apt install libimage-exiftool-perl
   ```
   (macOS: `brew install exiftool`, Windows: download from [exiftool.org](https://exiftool.org))

3. Copy `.env` and fill in your key:
   ```
   GEMINI_API_KEY=your_key_here
   DATA_DIR=./data
   ```

4. Install dependencies:
   ```
   uv sync
   ```
