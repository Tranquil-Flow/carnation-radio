.PHONY: all
.DELETE_ON_ERROR:

EXE := whistle

all: $(EXE)

whistle: $(EXE)

GCC := gcc
CFLAGS = -Wnone -O

.PHONY: clean
clean:
	rm -f *.o
	rm -f $(EXE)
	rm -f $(EXE).exe

${EXE}: aes.c rnd.c sha256.c whistle.c aes.h rnd.h sha256.h
	gcc aes.c rnd.c sha256.c whistle.c -o $(EXE)
