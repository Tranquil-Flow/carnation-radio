// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract AudioSetNFT is ERC721 {
    // Mapping from token ID to token URI
    mapping(uint256 => string) private _tokenURIs;
    uint256 private _currentTokenId = 0;

    // Address of the Auction contract
    address public auctionContract;

    error OnlyAuctionContract();

    constructor(address _auctionContract) ERC721("AudioSetNFT", "AUDIO") {
        auctionContract = _auctionContract;
    }

    modifier onlyAuction() {
        if (msg.sender != auctionContract) {
            revert OnlyAuctionContract();
        }
        _;
    }

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
