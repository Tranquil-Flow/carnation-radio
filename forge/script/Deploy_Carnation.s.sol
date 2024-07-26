// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "forge-std/Script.sol";
import "../src/CarnationAudioNFT.sol";
import "../src/CarnationAuction.sol";

contract DeployCarnationContracts is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Deploy CarnationAudioNFT
        CarnationAudioNFT audioNFT = new CarnationAudioNFT();

        // Deploy CarnationAuction
        CarnationAuction auction = new CarnationAuction(address(audioNFT));

        // Set the auction contract address in CarnationAudioNFT
        audioNFT.defineCarnationAuction(address(auction));

        console.log("CarnationAudioNFT deployed to:", address(audioNFT));
        console.log("CarnationAuction deployed to:", address(auction));

        vm.stopBroadcast();
    }
}