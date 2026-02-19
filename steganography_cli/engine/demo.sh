#!/bin/bash
# ============================================================
# Carnation Radio — Live Demo
# ============================================================
# This script demonstrates hiding an encrypted message inside
# audio, compressing it to MP3, and recovering the message.
# ============================================================

set -e

VENV="/Users/evinova/Documents/carnation-radio/.venv/bin/python"
ENGINE_DIR="/Users/evinova/Documents/carnation-radio/steganography_cli/engine"
cd "$ENGINE_DIR"

echo "============================================================"
echo "  CARNATION RADIO — Steganography Demo"
echo "============================================================"
echo ""

# Use provided WAV or the cat test file
INPUT_WAV="${1:-/tmp/carnation_cats.wav}"
if [ ! -f "$INPUT_WAV" ]; then
    echo "ERROR: No input WAV file found at $INPUT_WAV"
    echo "Usage: ./demo.sh [path/to/audio.wav]"
    echo ""
    echo "To convert an MP3 to WAV first:"
    echo "  ffmpeg -i song.mp3 -codec:a pcm_s16le -ar 44100 song.wav"
    exit 1
fi

MESSAGE="${2:-The revolution will not be televised. It will be broadcast on Carnation Radio.}"
PASSPHRASE="${3:-solidarity-forever}"

echo "Input:      $INPUT_WAV"
echo "Message:    \"$MESSAGE\""
echo "Passphrase: \"$PASSPHRASE\""
echo ""

# Step 1: Encode
echo "--- Step 1: Hiding encrypted message in audio ---"
$VENV cli.py encode "$INPUT_WAV" /tmp/carnation_encoded.wav "$MESSAGE" -p "$PASSPHRASE"
echo ""

# Step 2: Compress to MP3 at 128kbps (worst common case)
echo "--- Step 2: Compressing to MP3 at 128kbps ---"
ffmpeg -y -i /tmp/carnation_encoded.wav -codec:a libmp3lame -b:a 128k /tmp/carnation_encoded.mp3 2>/dev/null
echo "Compressed: /tmp/carnation_encoded.mp3"
ls -lh /tmp/carnation_encoded.mp3 | awk '{print "Size:      ", $5}'
echo ""

# Step 3: Decompress back to WAV (simulating receiving the MP3)
echo "--- Step 3: Decompressing MP3 back to WAV ---"
ffmpeg -y -i /tmp/carnation_encoded.mp3 -codec:a pcm_s16le -ar 44100 /tmp/carnation_received.wav 2>/dev/null
echo "Received:   /tmp/carnation_received.wav"
echo ""

# Step 4: Decode the hidden message
echo "--- Step 4: Extracting and decrypting hidden message ---"
$VENV cli.py decode /tmp/carnation_received.wav -p "$PASSPHRASE"
echo ""

# Step 5: Try wrong passphrase
echo "--- Step 5: Attempting with wrong passphrase ---"
$VENV cli.py decode /tmp/carnation_received.wav -p "wrong-password" 2>&1 || true
echo ""

echo "============================================================"
echo "  Demo complete!"
echo ""
echo "  You can listen to both files to compare:"
echo "    Original: $INPUT_WAV"
echo "    Encoded:  /tmp/carnation_encoded.wav"
echo "    MP3:      /tmp/carnation_encoded.mp3"
echo ""
echo "  Try with your own audio:"
echo "    ./demo.sh path/to/song.wav \"your message\" \"your-passphrase\""
echo "============================================================"
