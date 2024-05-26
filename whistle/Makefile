.PHONY: all
.DELETE_ON_ERROR:

EXE := whistle

all: $(EXE)

GCC := gcc
CFLAGS = -O -w

.PHONY: clean
clean:
	rm -f *.o
	rm -f $(EXE)
	rm -f $(EXE).exe

${EXE}: aes.c rnd.c sha256.c whistle.c aes.h rnd.h sha256.h
	gcc $(CFLAGS) aes.c rnd.c sha256.c whistle.c -o $(EXE)
