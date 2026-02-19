const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const CONTRACT_ADDRESS = process.env.LIBERDUS_SECONDARY_ADDRESS;
  if (!CONTRACT_ADDRESS) {
    throw new Error("Set LIBERDUS_SECONDARY_ADDRESS in your .env file");
  }

  const [deployer] = await hre.ethers.getSigners();
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const amount = ethers.parseUnits(process.env.AMOUNT_LIB || "100", 18);
  const targetAddress = process.env.TARGET_ADDRESS || deployer.address;

  console.log("Using account:", deployer.address);
  console.log("Chain ID:", Number(chainId));
  console.log("Contract Address:", CONTRACT_ADDRESS);

  const contract = await hre.ethers.getContractAt("LiberdusSecondary", CONTRACT_ADDRESS);

  const bridgeOutEnabled = await contract.bridgeOutEnabled();
  console.log("bridgeOutEnabled:", bridgeOutEnabled);
  if (!bridgeOutEnabled) {
    throw new Error("bridgeOut is disabled. Enable it via multisig first.");
  }

  const balance = await contract.balanceOf(deployer.address);
  console.log("Current Balance:", ethers.formatUnits(balance, 18), "LIB");
  if (balance < amount) {
    throw new Error(`Insufficient balance to bridge out. Have ${ethers.formatUnits(balance, 18)}, need ${ethers.formatUnits(amount, 18)}`);
  }

  console.log(`\nBridging out ${ethers.formatUnits(amount, 18)} LIB to ${targetAddress}...`);
  const tx = await contract.bridgeOut(amount, targetAddress, chainId);
  const receipt = await tx.wait();
  console.log("Transaction hash:", receipt.hash);

  const newBalance = await contract.balanceOf(deployer.address);
  console.log("New Balance:", ethers.formatUnits(newBalance, 18), "LIB");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
