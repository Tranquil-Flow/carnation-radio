import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployContracts: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const { ethers } = hre;

  // Deploy the Auction contract
  const auctionDeployment = await deploy("Auction", {
    from: deployer,
    log: true,
    autoMine: true,
  });

  const auctionContractAddress = auctionDeployment.address;
  if (!auctionContractAddress) {
    throw new Error("Failed to get Auction contract address");
  }

  // Deploy the AudioSetNFT contract with the Auction contract address as an argument
  const audioSetNFTDeployment = await deploy("AudioSetNFT", {
    from: deployer,
    args: [auctionContractAddress],
    log: true,
    autoMine: true,
  });

  const audioSetNFTContractAddress = audioSetNFTDeployment.address;
  if (!audioSetNFTContractAddress) {
    throw new Error("Failed to get AudioSetNFT contract address");
  }

  // Get the Auction contract instance
  const auctionContract = await ethers.getContractAt("Auction", auctionContractAddress);

  // Call the defineNFTcontract function on the Auction contract with the address of the deployed AudioSetNFT contract
  const tx = await auctionContract.defineNFTcontract(audioSetNFTContractAddress);
  await tx.wait();

  console.log(`Auction contract deployed at: ${auctionContractAddress}`);
  console.log(`AudioSetNFT contract deployed at: ${audioSetNFTContractAddress}`);
};

export default deployContracts;

deployContracts.tags = ["Auction", "AudioSetNFT"];
