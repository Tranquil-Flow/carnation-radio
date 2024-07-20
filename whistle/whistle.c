
/*

compile with:

$ gcc -O aes.c sha256.c rnd.c whistle.c -o whistle 

*/

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>

#include "aes.h"
#include "sha256.h"
#include "rnd.h"

//------------------------------------------------------------------------------

#define MIN(a,b)  ( ((a)<(b)) ? (a) : (b) )

#define METADATA_LEN 128

//------------------------------------------------------------------------------

const int debug = 0;

void error(const char *msg) {
  printf("%s\n",msg);
  exit(1);
}

//------------------------------------------------------------------------------

char nibble_encode(int x) {
  return ( (x<10) ? (x+48) : (x+55) );
}

uint8_t nibble_decode(char c) {
  if ((c >= 48) && (c< 58)) return (c-48);
  if ((c >= 65) && (c< 71)) return (c-55);
  if ((c >= 97) && (c<103)) return (c-87);
  return 0;  // hackety hack
}

void hex_encode(int n, const uint8_t *src, char *tgt) {
  for(int i=0; i<n; i++) {
    tgt[2*i]   = nibble_encode(src[i] >> 4  );
    tgt[2*i+1] = nibble_encode(src[i] & 0x0f);
  }
  tgt[2*n] = 0;
}

void hex_decode(int nchars, const char *src, uint8_t *tgt) {
  int j =0;
  for(int i=0; (i<nchars) && (src[i] !=0 ); i+=2) {
    tgt[j] = (nibble_decode(src[i]) << 4) + nibble_decode(src[i+1]);
    j+=1;
  }
}

void debugprint_hex(const char *msg, int nbytes, uint8_t *what) {
  if (debug) {
    printf("%s:\n  [", msg);
    for(int i=0; i<nbytes; i++) {
      printf( "%02x,", what[i] );
    }
    printf("...]\n");
  }
}

//------------------------------------------------------------------------------

typedef struct WAVE {
  // RIFF Header
  char     riff_header[4];   // Contains "RIFF"
  uint32_t wav_size;         // Size of the wav portion of the file, which follows the first 8 bytes. File size - 8
  char     wave_header[4];   // Contains "WAVE"
  
  // Format Header
  char     fmt_header[4];    // Contains "fmt " (includes trailing space)
  uint32_t fmt_chunk_size;   // Should be 16 for PCM
  uint16_t audio_format;     // Should be 1 for PCM. 3 for IEEE Float
  uint16_t num_channels;
  uint32_t sample_rate;
  uint32_t byte_rate;        // Number of bytes per second. sample_rate * num_channels * Bytes Per Sample
  uint16_t sample_alignment; // num_channels * Bytes Per Sample
  uint16_t bit_depth;        // Number of bits per sample
  
  // Data
  char     data_header[4];   // Contains "data"
  int32_t  data_bytes;       // Number of bytes in data. Number of samples * num_channels * sample byte size
} WAVE;

WAVE wav_header;

//------------------------------------------------------------------------------

void check_wav(FILE *finp) {
  
  fread(&wav_header,44,1,finp);

  if (  (strncmp(wav_header.riff_header,"RIFF",4)) 
     || (strncmp(wav_header.wave_header,"WAVE",4))
     || (strncmp(wav_header.fmt_header ,"fmt ",4))
     || (strncmp(wav_header.data_header,"data",4))
     ) {
    error("input is not a WAV file");
  }

  if (wav_header.fmt_chunk_size != 16) {
    error("invalid fmt chunk length (only PCM audio is suppported)");
  } 

  if (wav_header.audio_format != 1) {
    error("only PCM audio is suppported");
  } 

  if (wav_header.bit_depth != 16) {
    error("at the moment only 16 bit audio is suppported");
  } 

  if (debug) {
    printf("number of channels = %d\n",wav_header.num_channels    );
    printf("sample rate        = %d\n",wav_header.sample_rate     );
    printf("byte rate          = %d\n",wav_header.byte_rate       );
    printf("bit depth          = %d\n",wav_header.bit_depth       );
    printf("sample alignment   = %d\n",wav_header.sample_alignment);
  }

}

//------------------------------------------------------------------------------

// stride should be 4 bytes for 16 bit stereo
// this encodes only one channel
void encode_into_low_bits(int nsamples, uint8_t *src, uint8_t *tgt0, int stride) {
  uint8_t *tgt = tgt0;
  for(int i=0; i<nsamples; i++) {
    int b = (i & 0x07);
    int k = (i >> 3  ); 
    uint8_t bit = (src[k] >> b) & 1;
    
    // wav pcm is little endian
    tgt[0] = (tgt[0] & 0xfe) | bit;
    tgt += stride;

  }
}

void decode_from_low_bits(int nsamples, uint8_t *src, uint8_t *tgt, int stride) {
  memset(tgt, 0, (nsamples+7)/8);
  for(int i=0; i<nsamples; i++) {
    int b = (i & 0x07);
    int k = (i >> 3  ); 
    uint8_t bit = (src[stride*i] & 1);
    tgt[k] |= (bit << b);
  }
}

void randomize_low_bits(WAVE *wavhdr, SHA256_CTX *ctx, int nsamples, uint8_t *tgt) {
  int nchunks = (nsamples+255) / 256;             // hash state is 256 bits (or 32 bytes, or 8 words)

  // generate some random bits using sha256
  uint8_t *randomness = (uint8_t*) malloc(nchunks * 32);
  assert( randomness != 0 );

  uint8_t block[32];
  for(int i=0; i<nchunks; i++) {
    *(int*)(block  ) = i+1;
    *(int*)(block+4) = 137*i+100;
    sha256_update(ctx,block,32);
    memcpy( randomness + i*32 , ctx->state , 32 );
  }

  // put it there
  encode_into_low_bits(nsamples, randomness, tgt, wavhdr->sample_alignment);  

  free(randomness);
}

//------------------------------------------------------------------------------

#define BUFSIZE (33*1024*1024)        // this is enough for lot of audio and also for the encoded message 
//#define BUFSIZE (5*1024*1024)        // this is enough for lot of audio and also for the encoded message 

void copy_bytes(WAVE *wavhdr, FILE *fsrc, FILE *ftgt, int nsamples) {
  if (nsamples > 0) {
    uint8_t *buf = (uint8_t*) malloc( BUFSIZE );
    assert( buf != 0);
    int64_t Kmax = BUFSIZE / wavhdr->sample_alignment;
    int n = nsamples;
    while (n > 0) {
      int k = (n <= Kmax) ? n : Kmax;
      fread (buf, k, wavhdr->sample_alignment, fsrc);
      fwrite(buf, k, wavhdr->sample_alignment, ftgt);
      n -= k;
    }  
    free(buf);
  }
}

void copy_bytes_with_encoded_bits(WAVE *wavhdr, SHA256_CTX *ctx, uint8_t *message, FILE *fsrc, FILE *ftgt, int nsamples) {
  if (nsamples > 0) {
    uint8_t *buf = (uint8_t*) malloc( BUFSIZE );
    assert( buf != 0 );
    int64_t Kmax = BUFSIZE  / wavhdr->sample_alignment;
    int n = nsamples;
    while (n > 0) {
      int k = (n <= Kmax) ? n : Kmax;
      fread (buf, wavhdr->sample_alignment, k, fsrc);
  
      // randomize all channels
      for(int chn=0; chn < wavhdr->num_channels; chn++ ) {
        randomize_low_bits( wavhdr, ctx, k, buf + 2*chn );
      }
  
      // copy the data into the first channel
      encode_into_low_bits( k, message, buf, wavhdr->sample_alignment );
  
      // write out
      fwrite(buf, wavhdr->sample_alignment, k, ftgt);
      n -= k;
    }  
    free(buf);
  }
}

void copy_bytes_with_random_bits(WAVE *wavhdr, SHA256_CTX *ctx, FILE *fsrc, FILE *ftgt, int nsamples) {
  if (nsamples > 0) {
    uint8_t *buf = (uint8_t*) malloc( BUFSIZE );
    assert( buf != 0 );
    uint64_t Kmax = BUFSIZE  / wavhdr->sample_alignment;
    int n = nsamples;
    while (n > 0) {
      int k = (n <= Kmax) ? n : Kmax;
      fread (buf, wavhdr->sample_alignment, k, fsrc);
  
      // randomize all channels
      for(int chn=0; chn < wavhdr->num_channels; chn++ ) {
        randomize_low_bits( wavhdr, ctx, k, buf + 2*chn );
      }
  
      fwrite(buf, wavhdr->sample_alignment, k, ftgt);
      n -= k;
    }  
    free(buf);
  }
}

//------------------------------------------------------------------------------

void encrypt(const char *msgfile, const char* infile, const char *outfile) {

  if (debug) {
    printf("encrypting\n");
    printf("msg file    = %s\n",msgfile);
    printf("input file  = %s\n",infile);
    printf("output file = %s\n",outfile);
  }

  FILE *finp = fopen(infile,"rb");
  if (!finp) { error("fatal: cannot open input .wav file"); }
  check_wav(finp);

  FILE *fmsg = fopen(msgfile,"rb");
  if (!fmsg) { error("fatal: cannot open message file"); }
  fseek(fmsg, 0, SEEK_END);
  uint64_t msg_len = ftell(fmsg);
  fseek(fmsg, 0, SEEK_SET);

  if (debug) {
    printf("message length = %lld\n",msg_len);
  }
  if (msg_len > 256*1024) {
    error("messages of size larger than 256kb are not supported");
  }
  uint64_t msg_bits = msg_len*8;
  if (debug) {
    printf("message length in bits = %lld\n",msg_bits);
  }

  uint32_t nsamples = wav_header.data_bytes / wav_header.sample_alignment;
  uint32_t nseconds = nsamples / wav_header.sample_rate;
  if (debug) {
    printf("number of samples = %d\n",nsamples);
    printf("number of seconds = %d\n",nseconds);
  }

  int SAMPLERATE = wav_header.sample_rate;

  uint64_t rem_samples = nsamples - msg_bits;
  if (rem_samples < SAMPLERATE*5) {                                  // we leave place for 5 seconds (3 at the beginning + 1 at end + metadata + the key + safety buffer)
    error("message is too long for this sound file!");
  }

  uint64_t max_offset = MIN( rem_samples - 2*SAMPLERATE , SAMPLERATE*10 );    // min 2 second, max 12 seconds offset from the start
  uint64_t offset     = 2*SAMPLERATE + (my_random_long() % max_offset);       // add the 3 seconds back
  offset = ((offset >> 3) << 3);                                              // make it whole byte boundary  

offset=0;  // TMP DEBUGGING - TODO REMOVE

  if (debug) {
    printf("offset   (samples)   = %llu\n",offset);
    printf("offset/8 (msg bytes) = %llu\n",offset/8);
    printf("offset in seconds    = %0.2f\n",((double)offset)/SAMPLERATE);
  }
 
  // read the message 

  uint8_t *msgbuf = (uint8_t*) malloc(msg_len);
  fread(msgbuf,1,msg_len,fmsg);
  fclose(fmsg);

  // cook up a key

  unsigned long rnd1, rnd2;
  SHA256_CTX ctx;
  sha256_init(&ctx);
  rnd1 = my_random_long();
  rnd2 = my_random_long();
  if (debug) {
    int x = sizeof(unsigned long);
    printf("sizeof(unsigned long) = %d\n",x);
    printf("rnd1 = %lu\n",rnd1);
    printf("rnd2 = %lu\n",rnd2);
  }
  sha256_update(&ctx,msgbuf,msg_len);
  sha256_update(&ctx, (uint8_t*)(&rnd1), sizeof(unsigned long) );
  sha256_update(&ctx, (uint8_t*)(&rnd2), sizeof(unsigned long) );
  uint8_t key[32];
  sha256_final(&ctx, key);
  char hex_key[65];
  hex_encode(32,key,hex_key);

  // also an AES key
  
  sha256_update(&ctx, (uint8_t*)(&rnd2), sizeof(unsigned long) );
  sha256_update(&ctx, (uint8_t*)(&rnd1), sizeof(unsigned long) );
  uint8_t aes_key[32];
  sha256_final(&ctx, aes_key);

  // blind the AES key
  uint8_t blinded_aes_key[16];
  for(int i=0; i<16; i++) blinded_aes_key[i] = (aes_key[i] ^ key[i+16]);

  // and an IV
  
  sha256_update(&ctx, (uint8_t*)(&rnd1), sizeof(unsigned long) );
  sha256_update(&ctx, (uint8_t*)(&rnd2), sizeof(unsigned long) );
  uint8_t aes_IV[32];
  sha256_final(&ctx, aes_IV);

  if (debug) {
    char hex_blinded_aes_key[33];
    char hex_aes_key[33];
    char hex_aes_iv [33];
    hex_encode(16,blinded_aes_key,hex_blinded_aes_key);
    hex_encode(16,aes_key,hex_aes_key);
    hex_encode(16,aes_IV ,hex_aes_iv );
    printf("blinded key = %s\n",hex_blinded_aes_key);
    printf("aes key     = %s\n",hex_aes_key);
    printf("aes iv      = %s\n",hex_aes_iv );
  }

  printf("KEY = %s\n",hex_key);

  // metadata (data length + filename)

  uint8_t metadata[METADATA_LEN];
  *(uint32_t*)metadata = msg_len;
  strncpy( (char*)(metadata+4) , msgfile , METADATA_LEN-4);
  metadata[ METADATA_LEN - 1 ] = 0;

  FILE *fout = fopen(outfile,"wb");
  if (!fout) { error("fatal: cannot create output file"); }
  fwrite(&wav_header,44,1,fout);

  // encrypt metadata + message

  int aes_len    = METADATA_LEN + msg_len;
  int aes_blocks = (aes_len + 15) / 16;
  aes_len = aes_blocks * 16;

  uint8_t *cyphertext = (uint8_t*) malloc( aes_blocks * 16 );

  memcpy( cyphertext              , metadata , METADATA_LEN );
  memcpy( cyphertext+METADATA_LEN , msgbuf   , msg_len      );

  struct AES_ctx aes_ctx;
  AES_init_ctx_iv( &aes_ctx, aes_key, aes_IV );
  AES_CBC_encrypt_buffer( &aes_ctx, cyphertext , aes_blocks * 16 );

  // copy music
  
  int64_t rest =  nsamples - offset - 128*(3+aes_blocks);
  if (debug) { printf("size of rest = %lld\n",rest); }  

  copy_bytes_with_random_bits  (&wav_header, &ctx                  , finp, fout, offset    );
  copy_bytes_with_encoded_bits (&wav_header, &ctx , key            , finp, fout, 128 );               // start pattern key
  copy_bytes_with_encoded_bits (&wav_header, &ctx , blinded_aes_key, finp, fout, 128 );               // blinded AES key
  copy_bytes_with_encoded_bits (&wav_header, &ctx , aes_IV         , finp, fout, 128 );               // AES IV
  copy_bytes_with_encoded_bits (&wav_header, &ctx , cyphertext     , finp, fout, aes_blocks * 128 );  // cyphertext bits
  copy_bytes_with_random_bits  (&wav_header, &ctx                  , finp, fout, rest );

  if (debug) {
    debugprint_hex("the start pattern",16,key);
    debugprint_hex("the blinded key"  ,16,blinded_aes_key);
  } 

  // cleanup

  free(cyphertext);
  free(msgbuf);

  fclose(finp);
  fclose(fout);

}

//------------------------------------------------------------------------------

void decrypt(const char *hex_key, const char* infile, const char *outmsgfile) {

  if (debug) {
    printf("decrypting\n");
    printf("key            = `%s`\n",hex_key   );
    printf("input file     = `%s`\n",infile    );
    printf("decrypted file = `%s`\n",outmsgfile);
  }

  FILE *finp = fopen(infile,"rb");
  if (!finp) { error("cannot open input .wav file"); }
  check_wav(finp);

  // decode the hex key

  uint8_t key[32];
  hex_decode( MIN(64,strlen(hex_key)) , hex_key , key );

  if (debug) {
    char reconstructed_hex_key[65];
    hex_encode( 32, key, reconstructed_hex_key);
    printf("KEY = %s\n",reconstructed_hex_key);
  }  

  // load the first part of the sound data (hoperfully enough to find the start

  uint8_t *buf = (uint8_t*) malloc( BUFSIZE );
  int m = fread(buf, 1, BUFSIZE, finp);

  if (debug) {
    printf("loaded %d bytes\n",m);
  }

  // extract bits

  int act_nsamples = m / wav_header.sample_alignment;           // number of samples we loaded
  int act_nbytes   = act_nsamples / 8;                          // each sample encodes 1 bit

  if (debug) {
    printf("loaded # samples (=possibly encoded bits) = %d\n",act_nsamples);
    printf("...corresponding to # of encoded bytes    = %d\n",act_nbytes  );
  }

  uint8_t *bits = (uint8_t*) malloc( BUFSIZE / 8 );
  decode_from_low_bits(act_nsamples, buf, bits, wav_header.sample_alignment );    // channel 0

  if (debug) {
    debugprint_hex("first few bytes of the extracted bits", 20, bits);
  } 

  // search for start pattern

  int found  = 0;
  int offset = 0;
  uint8_t *ptr = bits;
  for (int j=0; j<(act_nbytes-16); j++) {
    if ( 0 == memcmp( ptr , key , 16 )) {
      found  = 1;
      offset = (ptr - bits);
    }
    ptr++;
  }

  if (!found) {
    printf("encrypted message not found in this wav file... :(\n");
  }
  else {
    if (debug) {
      printf("encrypted message found!\n");
      printf("offset = %d\n",offset);
    }

    fseek( finp, 44 + (offset * 8 * wav_header.sample_alignment) , SEEK_SET );
    int m = fread( buf, 1, BUFSIZE, finp );

    int nsamples = m / wav_header.sample_alignment;
    decode_from_low_bits(nsamples, buf, bits, wav_header.sample_alignment );

    uint8_t aes_key[16];
    uint8_t aes_IV[16];

    for(int i=0;i<16;i++) { 
      aes_key[i] = bits[16+i] ^ key[16+i];
    }
    memcpy(aes_IV, bits+32, 16);

    debugprint_hex("blinded aes key", 16, bits+16 );
    debugprint_hex("aes key        ", 16, aes_key );
    debugprint_hex("aes IV         ", 16, aes_IV  );

    struct AES_ctx aes_ctx;
    AES_init_ctx_iv( &aes_ctx, aes_key, aes_IV );
    int aes_blocks = (m - 48) / 16;
    AES_CBC_decrypt_buffer( &aes_ctx, bits+48 , aes_blocks * 16 );

    int msg_len = *(uint32_t*)(bits+48);
    char orig_fname    [METADATA_LEN];
    char msg_out_fname [METADATA_LEN+16];
    memcpy(orig_fname   , bits+48+4 , METADATA_LEN);
    memcpy(msg_out_fname, orig_fname, METADATA_LEN);
    strcat(msg_out_fname, ".decrypted");
    if (debug) {
      printf("message length = %d\n",msg_len);
      printf("original file name = `%s`\n",orig_fname);
    }

    if (strlen(outmsgfile)!=0) {
      strcpy( msg_out_fname, outmsgfile );
    }

    printf("output file name = `%s`\n",msg_out_fname);

    FILE *fmsg = fopen(msg_out_fname,"wb");
    if (!fmsg) { error("fatal: cannot create decrypted message file"); }
    fwrite( bits+48+METADATA_LEN , 1 , msg_len , fmsg );
    fclose(fmsg);

  }
 
  // free up stuff
   
  free(bits);
  free(buf);
  fclose(finp);

}

//------------------------------------------------------------------------------

void help() {
  printf("usage:\n\n");
  printf("$ whistle encrypt message.dat input.wav output.wav\n");
  printf("$ whistle decrypt <key> input.wav\n");
  printf("$ whistle decrypt <key> input.wav decrypted.msg\n");
  exit(0);
}

int main(int argc, char *argv[]) {

  if (argc < 2) {
    help();
    return 0;
  }

  if (0==strncmp(argv[1],"encrypt",10)) {
    if (argc != 5) {
      help();
    }
    else {
      my_random_init();
      encrypt(argv[2],argv[3],argv[4]);
    }
    return 0;
  }

  if (0==strncmp(argv[1],"decrypt",10)) {
    if ((argc != 4) && (argc!= 5)) {
      help();
    }
    else {
      switch(argc) {
        case 4:
          decrypt(argv[2],argv[3],"");
          break;
        case 5:
          decrypt(argv[2],argv[3],argv[4]);
          break;
        default:
          help();
          exit(0);
          break;
      }
    }
    return 0;
  }

  printf("invalid command `%s`\n",argv[1]);
  return 0;
}

//------------------------------------------------------------------------------
