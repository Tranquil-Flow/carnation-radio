#!/usr/bin/env python3
"""
Carnation Radio CLI

Encode and decode secret encrypted messages in audio files.
Messages survive MP3 compression at 128kbps+.

Usage:
    python cli.py encode input.wav output.wav "secret message" --passphrase "key"
    python cli.py decode output.wav --passphrase "key"
"""

import argparse
import sys

from carnation import hide_message, reveal_message


def cmd_encode(args):
    """Encode a secret message into an audio file."""
    try:
        stats = hide_message(
            args.input, args.output, args.message,
            passphrase=args.passphrase,
            delta=args.strength,
        )
        print(f"Message hidden successfully!")
        print(f"  Plaintext:  {stats['plaintext_size']} bytes")
        print(f"  Encrypted:  {stats['encrypted_size']} bytes")
        print(f"  Bits used:  {stats['bits_embedded']}")
        print(f"  Frames:     {stats['frames_used']}")
        print(f"  Output:     {args.output}")
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_decode(args):
    """Decode a secret message from a watermarked audio file."""
    try:
        message = reveal_message(args.input, passphrase=args.passphrase)
        if args.raw:
            sys.stdout.write(message)
        else:
            print(f"Decoded message: {message}")
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Carnation Radio - Hide encrypted messages in audio",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s encode song.wav encoded.wav "meet at dawn" -p "secret123"
  %(prog)s decode encoded.wav -p "secret123"
  %(prog)s encode song.wav encoded.wav "$(cat message.txt)" -p "key"
        """,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # Encode
    enc = sub.add_parser("encode", help="Hide a message in audio")
    enc.add_argument("input", help="Input WAV file")
    enc.add_argument("output", help="Output WAV file (with hidden message)")
    enc.add_argument("message", help="The secret message to hide")
    enc.add_argument("-p", "--passphrase", required=True,
                     help="Passphrase for encryption")
    enc.add_argument("-s", "--strength", type=float, default=200.0,
                     help="Embedding strength (default: 200, higher=more robust)")

    # Decode
    dec = sub.add_parser("decode", help="Extract a message from audio")
    dec.add_argument("input", help="Watermarked WAV/audio file")
    dec.add_argument("-p", "--passphrase", required=True,
                     help="Passphrase for decryption")
    dec.add_argument("--raw", action="store_true",
                     help="Output raw message without prefix")

    args = parser.parse_args()

    if args.command == "encode":
        cmd_encode(args)
    elif args.command == "decode":
        cmd_decode(args)


if __name__ == "__main__":
    main()
