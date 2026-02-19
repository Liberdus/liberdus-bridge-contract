const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const CONTRACT_ADDRESS = process.env.LIBERDUS_SECONDARY_ADDRESS;
  if (!CONTRACT_ADDRESS) {
    throw new Error("Set LIBERDUS_SECONDARY_ADDRESS in your .env file");
  }

  const [deployer] = await hre.ethers.getSigners();
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const amount = ethers.parseUnits(process.env.AMOUNT_LIB || "10000", 18);
  const recipient = process.env.TARGET_ADDRESS || deployer.address;
  const txId = process.env.TX_ID || `testnet-bridge-in-${Date.now()}`;

  console.log("Using account:", deployer.address);
  console.log("Chain ID:", chainId);
  console.log("Contract Address:", CONTRACT_ADDRESS);

  const contract = await hre.ethers.getContractAt("LiberdusSecondary", CONTRACT_ADDRESS);

  const bridgeInEnabled = await contract.bridgeInEnabled();
  console.log("bridgeInEnabled:", bridgeInEnabled);
  if (!bridgeInEnabled) {
    throw new Error("bridgeIn is disabled. Enable it via multisig first.");
  }

  const bridgeInCaller = await contract.bridgeInCaller();
  console.log("bridgeInCaller:", bridgeInCaller);
  if (bridgeInCaller.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Deployer is not the bridgeInCaller. Expected ${deployer.address}, got ${bridgeInCaller}`);
  }

  const hashedTxId = ethers.id(txId);
  const isProcessed = await contract.processedTxIds(hashedTxId);
  if (isProcessed) {
    throw new Error(`Transaction ID ${txId} (hash: ${hashedTxId}) has already been processed.`);
  }

  console.log(`\nBridging in ${ethers.formatUnits(amount, 18)} LIB to ${recipient}...`);
  const tx = await contract.bridgeIn(recipient, amount, chainId, ethers.id(txId));
  const receipt = await tx.wait();
  console.log("Transaction hash:", receipt.hash);

  const balance = await contract.balanceOf(recipient);
  console.log("Balance:", ethers.formatUnits(balance, 18), "LIB");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
