
whistle cli
===========

This is a steganography tool for musical carrier waves; a quick hack @ ethBerlin4.


build
-----

    $ gcc -O aes.c sha256.c rnd.c whistle.c -o whistle

or maybe just:

    $ make all


use
---

    $ whistle encrypt message.dat input.wav output.wav
    $ whistle decrypt <key> input.wav


what happens under the hood
---------------------------

Your message is encoded in the lowest bits of the first channel of a 16 bit 
(CD quality) `.wav` sound file, which is normally white noise (and after the 
encoding, it indeed will be white noise, that one bit of information, around 
-90 dB, completely destroyed).

The message is placed at a random location starting somewhere in the first 15
seconds or so. The encoded message consists of:

- a handshake pattern (128 random bits)
- a blinded AES key (another 128 bits of randomly looking data)
- a random initialiation vector (yet another 128 random bits)
- the augmented message encrypted with AES128 with the above (unblinded) key + IV

The augmented message consists of:

- metadata, containing the message length and the original file name
- and finally the actual message

To be able even detect that there is a message hidden in a given `.wav` file,
the adversary needs to know the 128 bit starting pattern; then to actually
decode it, they also need the another 128 bit of blinding key, which unblinds 
the actual AES decoding key. Even the metadata is encrypted.

Since all the low bits are statistically totally random (in fact, after the 
encoding, they are forcibly randomized), this is all plausible deniable.


third-party library credits
---------------------------

- AES code is by kokke, and is public domain: https://github.com/kokke/tiny-AES-c
- SHA256 code is by Brad Conte and is under "unlicense": https://github.com/B-Con


TODO
----

- [x] add a makefile
- [x] make it possible to specify the output file name
- [ ] make a checksum or HMAC or something, for the unlikely case when the decryption 
      key is wrong but the pattern key is right; then it should say bad decryption key 
      instead of a segfault crash
- [ ] add an error-correcting code to the message (would be more important with
      a more robust message encoding)
- [ ] add a more robust encoding option which survives mp3 etc encoding
- [ ] ...

