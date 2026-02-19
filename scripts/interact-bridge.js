const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer, signer1, signer2, signer3] = await hre.ethers.getSigners();

  const LIBERDUS_SEC_ADDR = process.env.LIBERDUS_SECONDARY_ADDRESS || "";
  if (!LIBERDUS_SEC_ADDR) {
    throw new Error("Set LIBERDUS_SECONDARY_ADDRESS in .env");
  }

  const balanceOnly = process.env.BALANCE_ONLY === "true" || process.env.BALANCE_ONLY === "1";

  console.log("Interacting with LiberdusSecondary...");
  console.log("Deployer:", deployer.address);
  console.log("Signer 1:", signer1.address);
  console.log("Signer 2:", signer2.address);
  console.log("Signer 3:", signer3.address);

  const LiberdusSecondary = await ethers.getContractFactory("LiberdusSecondary");
  const liberdusSecondary = LiberdusSecondary.attach(LIBERDUS_SEC_ADDR);

  // ====================================================
  // TOKEN & ETH BALANCE CHECK
  // ====================================================
  console.log("\n--- Token & ETH Balances ---");
  const accounts = [
    { name: "Deployer", address: deployer.address },
    { name: "Signer 1", address: signer1.address },
    { name: "Signer 2", address: signer2.address },
    { name: "Signer 3", address: signer3.address },
  ];
  for (const account of accounts) {
    const bal = await liberdusSecondary.balanceOf(account.address);
    const ethBal = await deployer.provider.getBalance(account.address);
    console.log(`${account.name} (${account.address}):`);
    console.log(`  LIB: ${ethers.formatUnits(bal, 18)} LIB`);
    console.log(`  ETH: ${ethers.formatUnits(ethBal, "ether")} ETH`);
  }

  if (balanceOnly) {
    console.log("\n--- Balance check complete ---");
    return;
  }

  // ====================================================
  // BRIDGE OUT (Secondary -> Liberdus Network)
  // ====================================================
  console.log("\n--- Bridge Out (Secondary -> Liberdus Network) ---");
  const bridgeOutAmount = ethers.parseUnits(process.env.BRIDGE_OUT_AMOUNT || "5", 18);
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  const bridgeOutEnabled = await liberdusSecondary.bridgeOutEnabled();
  console.log(`bridgeOutEnabled: ${bridgeOutEnabled}`);
  const signer1Bal = await liberdusSecondary.balanceOf(signer1.address);
  console.log(`Signer 1 Balance: ${ethers.formatUnits(signer1Bal, 18)} LIB`);

  if (!bridgeOutEnabled) {
    console.log("Skipping Bridge Out: bridgeOut is disabled.");
  } else if (signer1Bal >= bridgeOutAmount) {
    const outTx = await liberdusSecondary.connect(signer1).bridgeOut(bridgeOutAmount, signer1.address, chainId);
    await outTx.wait();
    console.log("Bridge out successful.");
    console.log(`Signer 1 New Balance: ${ethers.formatUnits(await liberdusSecondary.balanceOf(signer1.address), 18)} LIB`);
  } else {
    console.log(`Skipping Bridge Out: signer1 needs at least ${ethers.formatUnits(bridgeOutAmount, 18)} LIB.`);
  }

  console.log("\n--- Interaction Complete ---");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
