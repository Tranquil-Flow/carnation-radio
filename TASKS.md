# Milestone: Phase 1 — Steganography Engine

## Tasks
- [ ] Study Modified Patchwork Algorithm paper (Yeo & Kim, 2003) in depth
- [ ] Design encoder/decoder architecture in TypeScript
- [ ] Implement patchwork FFT-based embedding (clean-room, no GPL code)
- [ ] Add AES-GCM encryption for Raw Key mode
- [ ] Implement Web Audio API decoder for browser playback
- [ ] Build CLI tool for power users
- [ ] Test survival against MP3 compression at 128kbps+
- [ ] Create simple demo webapp

## Project Notes
Carnation FM v2 is a rewrite of a hackathon project. The original steganography approaches (LSB and subsonic) are both broken for radio use — see PROJECT_ANALYSIS.md for full analysis. The chosen approach is patchwork/spread spectrum in the audible range. This MUST be a clean-room implementation from academic papers — never reference audiowmark GPL code. The project has existing `forge/` (Solidity contracts on Sepolia), `frontend/` (Next.js shell), and `steganography_cli/` (broken C and JS encoders) directories. Phase 1 focuses purely on the steganography engine in TypeScript.
