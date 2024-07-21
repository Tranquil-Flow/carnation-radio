
// hackety hack hack

#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/time.h>

#include "rnd.h"

int urandom_fd = -2;

void my_random_init() {

  // fallback
  struct timeval tv;
  gettimeofday(&tv,NULL);
  unsigned int x = tv.tv_sec*7 + tv.tv_usec*3;
  srand( x );
  
  // urandom
  urandom_fd = open("/dev/urandom", O_RDONLY);
}

unsigned long urandom() {
  unsigned long buf_impl;
  unsigned long *buf = &buf_impl;

  if (urandom_fd == -2) {
    my_random_init();
  }

  /* Read sizeof(long) bytes (usually 8) into *buf, which points to buf_impl */
  read(urandom_fd, buf, sizeof(long));
  return buf_impl;
}

unsigned long my_random_long() {
  if (urandom_fd < 0) {
    unsigned long x0 = rand();
    unsigned long x1 = rand();
    unsigned long x2 = rand();
    unsigned long x3 = rand();
    return (x0 + (x1<<16) + (x2<<32) + (x3<<48) );
  }
  else {
    return urandom();
  }
}

