import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployContracts: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const { ethers } = hre;

  // Deploy the CarnationAuction contract
  const auctionDeployment = await deploy("CarnationAuction", {
    from: deployer,
    log: true,
    autoMine: true,
  });

  const auctionContractAddress = auctionDeployment.address;
  if (!auctionContractAddress) {
    throw new Error("Failed to get Auction contract address");
  }
  console.log(`Auction contract deployed at: ${auctionContractAddress}`);

  // Deploy the AudioNFT contract with the Auction contract address as an argument
  const audioNFTDeployment = await deploy("AudioNFT", {
    from: deployer,
    args: [auctionContractAddress],
    log: true,
    autoMine: true,
  });

  const audioSetNFTContractAddress = audioNFTDeployment.address;
  if (!audioSetNFTContractAddress) {
    throw new Error("Failed to get AudioSetNFT contract address");
  }
  console.log(`AudioSetNFT contract deployed at: ${audioSetNFTContractAddress}`);

  // Get the Auction contract instance
  const auctionContract = await ethers.getContractAt("CarnationAuction", auctionContractAddress);

  // Call the defineNFTcontract function on the Auction contract with the address of the deployed AudioSetNFT contract
  const tx = await auctionContract.defineNFTcontract(audioSetNFTContractAddress);
  await tx.wait();

  // Call the startAuctionFirst function on CarnationAuction contract
  const tx2 = await auctionContract.startAuctionFirst();
  await tx2.wait();
  console.log("Auctions started successfully");
};

export default deployContracts;

deployContracts.tags = ["Auction", "AudioSetNFT"];
