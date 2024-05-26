
whistle
=======

This is a sound steganography tool quick hack @ ethBerlin.

build
-----

    $ gcc -O aes.c sha256.c rnd.c whistle.c -o whistle

or maybe just:

    $ make all

use
---

    $ whistle encrypt message.dat input.wav output.wav
    $ whistle decrypt <key> input.wav

third-party library credits
---------------------------

- AES code is by kokke, and is public domain: https://github.com/kokke/tiny-AES-c
- SHA256 code is by Brad Conte and is under "unlicense": https://github.com/B-Con

TODO
----

- [x] add a makefile
- [x] make it possible to specify the output file name
- [ ] make a checksum or HMAC or something, so if the decryption key is wrong 
      but the pattern key is right, then it says bad decryption key instead of a crash
- [ ] add an error-correcting code to the message
- [ ] add a more robust encoding option which survives mp3 etc encoding
- [ ] ...