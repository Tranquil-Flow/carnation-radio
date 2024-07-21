# carnation-radio : steganography

## prep

### get your sound file 
```
Move your audio file to this folder or download one like below;

cd ./steganography/Step1_encodefile

```
```
If you want to get a test file, you can use yt-dlp
https://github.com/yt-dlp/yt-dlp/wiki/Installation

Once installed; 

yt-dlp "link" 

*example:*
yt-dlp "https://www.youtube.com/watch?v=6wxiu1n474w"

only download audio that's within your right to do so.

```
### format the file to .wav
``` 
Here we're applying .wav encodings :
If you have your own .wav file already, you can skip this part and jump to encode. We will need to install ffmpeg to transform the potential downloaded file to a .wav file. 


https://ffmpeg.org/download.html
https://www.hostinger.com/tutorials/how-to-install-ffmpeg
THIS DOES NOT WORK ON ARM (M1/M2/M3 Apple Processors), if you have one of these youll need to transform through your own means your file to .wav or download a .wav somewhere else.

you can run this command:

ffmpeg -i [SongNameAccordingToFile.xxx] -acodec pcm_u8 -ar 41000 [SongNameAccordingToFile.wav]

*example:*
ffmpeg -i Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].opus -acodec pcm_u8 -ar 41000 Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Let 2ra\)\ \[6wxiu1n474w\].wav
```

##### Future implementations (ignore these for now)
###### .wav -> .flac 16 bit
ffmpeg -i Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].wav -af aformat=s16:44100 Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].flac

###### .wav -> .mp3
ffmpeg -i Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].wav -acodec mp3 -ab 64k Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].mp3

### encode
```
Here we will run our encoder on your .WAV file to ensure we have the right format to encrypt the song on. 

Don't forget to run NPM Install ahead!

node encode.js [FILENAME.wav] encoded[FILENAME].wav

*example:*
node encode.js Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].wav encoded.wav 


if you get an error code, try adding; npm install flac-bindings

```

##### Upcoming (ignore for now)
 .flac
node encode.js Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].wav encoded.flac 


## Final
Now we have encoded our file, go to. Instructions located in folder  ./Step2_AudioEncryptWhistle


### incase to change params
not needed for standard installation
`constants/index.js` contains the following:
* `sampleRate` - shouldn't need changing
* `f0` & `f1` - zero bit and one bit signalling frequencies in Hz. They should be below 40Hz to be inaudible.
* `bitDuration` - About 5 / MIN(f0, f1) works well.
* ` outputOriginalPercentage` & `outputSubsonicPercentage` - should total 100 unless intending to make the output quieter/ louder. In testing, 49:1 ratio worked well.


