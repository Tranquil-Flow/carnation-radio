// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract AudioSetNFT is ERC721 {
    string public tokenURI;
    address public owner;

    constructor(string memory _tokenURI) ERC721("AudioSetNFT", "AUDIO") {
        tokenURI = _tokenURI;
        owner = msg.sender;
    }

    function mint(address to) public {
        require(msg.sender == owner, "Only owner can mint");
        _safeMint(to, 1);
    }

    function _baseURI() internal view override returns (string memory) {
        return tokenURI;
    }
}
