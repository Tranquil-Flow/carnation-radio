// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title CarnationAudioNFT
/// @author Tranquil-Flow
/// @notice An NFT that stores music played during the latest CarnationAuction
contract CarnationAudioNFT is ERC721 {
    // Mapping from token ID to token URI
    mapping(uint256 => string) private _tokenURIs;
    uint256 private _currentTokenId = 0;

    // Address of the Auction contract
    address public auctionContract;

    error OnlyAuctionContract();

    /// @notice Creates the NFT collection
    constructor() ERC721("CarnationRadio AudioNFT", "CARNATION_AUDIO") {
    }

    /// @notice Defines the auction contract
    /// @param _auctionContract The deployed address of CarnationAuction
    function defineCarnationAuction(address _auctionContract) external {
        auctionContract = _auctionContract;
    }

    modifier onlyAuction() {
        if (msg.sender != auctionContract) {
            revert OnlyAuctionContract();
        }
        _;
    }

    /// @notice Mints a CarnationAudioNFT
    /// @dev Can only be called by CarnationAuction, no public mint
    function mint(address to, string memory _tokenURI) external onlyAuction returns (uint256) {
        _currentTokenId++;
        uint256 newTokenId = _currentTokenId;
        _safeMint(to, newTokenId);
        _setTokenURI(newTokenId, _tokenURI);
        return newTokenId;
    }

    function _setTokenURI(uint256 tokenId, string memory _tokenURI) internal {
        _tokenURIs[tokenId] = _tokenURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        return _tokenURIs[tokenId];
    }
}
