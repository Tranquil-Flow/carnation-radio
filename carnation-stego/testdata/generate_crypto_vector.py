"""Generate crypto test vector for TypeScript cross-compat testing."""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../steganography_cli/engine"))
from crypto import encrypt_message, decrypt_message

passphrase = "cross-compat-test"
plaintext = b"Crypto cross-compat!"
ciphertext = encrypt_message(plaintext, passphrase)

# Verify Python can decrypt
assert decrypt_message(ciphertext, passphrase) == plaintext

vector = {
    "passphrase": passphrase,
    "plaintext": plaintext.decode(),
    "ciphertext_hex": ciphertext.hex(),
}
with open("testdata/crypto_vector.json", "w") as f:
    json.dump(vector, f, indent=2)

print(f"Generated crypto vector: {len(ciphertext)} bytes ciphertext")
