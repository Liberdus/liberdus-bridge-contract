const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const [deployer, signer1, signer2, signer3] = await hre.ethers.getSigners();

  const LIBERDUS_SEC_ADDR = process.env.LIBERDUS_SECONDARY_ADDRESS;
  const BRIDGE_IN_CALLER_SECONDARY = process.env.BRIDGE_IN_CALLER_SECONDARY;

  // Comma-separated recipient addresses for ETH transfers
  // Bridge caller is included automatically and deduplicated
  const RECIPIENTS = [...new Set([
    ...(BRIDGE_IN_CALLER_SECONDARY && ethers.isAddress(BRIDGE_IN_CALLER_SECONDARY) ? [BRIDGE_IN_CALLER_SECONDARY] : []),
    ...(process.env.RECIPIENTS || signer1.address + "," + signer2.address + "," + signer3.address)
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a && ethers.isAddress(a)),
  ].map((a) => a.toLowerCase()))];

  const ETH_AMOUNT = process.env.ETH_AMOUNT || "10";
  const SECONDARY_BRIDGE_IN_ENABLED = process.env.SECONDARY_BRIDGE_IN_ENABLED;
  const SECONDARY_BRIDGE_OUT_ENABLED = process.env.SECONDARY_BRIDGE_OUT_ENABLED;

  const OP_TYPES = Object.freeze({
    SET_BRIDGE_IN_CALLER: 0,
    SET_BRIDGE_IN_ENABLED: 3,
    SET_BRIDGE_OUT_ENABLED: 4,
  });

  let signers;
  if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
    signers = [deployer, signer1, signer2, signer3];
  } else {
    throw new Error("This script is designed for local networks only");
  }

  function parseOptionalBoolean(rawValue, envName) {
    if (rawValue === undefined || rawValue === null || rawValue === "") return null;
    const normalized = String(rawValue).trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
    throw new Error(`${envName} must be one of: true, false, 1, 0`);
  }

  async function requestAndSignOperation(contract, operationType, target, value, data) {
    const tx = await contract.requestOperation(operationType, target, value, data);
    const receipt = await tx.wait();
    const operationRequestedEvent = receipt.logs.find(
      (log) => log.fragment.name === "OperationRequested",
    );
    const operationId = operationRequestedEvent.args.operationId;

    for (let i = 0; i < 3; i++) {
      const messageHash = await contract.getOperationHash(operationId);
      const signature = await signers[i].signMessage(ethers.getBytes(messageHash));
      await contract.connect(signers[i]).submitSignature(operationId, signature);
    }
    return operationId;
  }

  const LiberdusSecondary = await ethers.getContractFactory("LiberdusSecondary");
  const liberdusSecondary = LiberdusSecondary.attach(LIBERDUS_SEC_ADDR);

  console.log("Deployer:", deployer.address);
  console.log("Secondary contract:", LIBERDUS_SEC_ADDR);

  try {
    await liberdusSecondary.symbol();
  } catch (error) {
    throw new Error(`LIBERDUS_SECONDARY_ADDRESS is not a LiberdusSecondary/ERC20 contract: ${LIBERDUS_SEC_ADDR}`);
  }

  // ====================================================
  // 1. ETH TRANSFERS
  // ====================================================
  if (RECIPIENTS.length > 0) {
    console.log("\n--- Transferring ETH ---");
    const ethAmount = ethers.parseUnits(ETH_AMOUNT, "ether");
    for (const recipient of RECIPIENTS) {
      console.log(`Transferring ${ETH_AMOUNT} ETH to ${recipient}...`);
      const tx = await deployer.sendTransaction({ to: recipient, value: ethAmount });
      await tx.wait();
      console.log(`  Done.`);
    }
  }

  // ====================================================
  // 2. SET BRIDGE-IN CALLER
  // ====================================================
  if (BRIDGE_IN_CALLER_SECONDARY && ethers.isAddress(BRIDGE_IN_CALLER_SECONDARY)) {
    const currentCaller = await liberdusSecondary.bridgeInCaller();
    if (currentCaller.toLowerCase() === BRIDGE_IN_CALLER_SECONDARY.toLowerCase()) {
      console.log(`\nBridgeInCaller already set to ${BRIDGE_IN_CALLER_SECONDARY}, skipping.`);
    } else {
      console.log(`\n--- Setting BridgeInCaller to ${BRIDGE_IN_CALLER_SECONDARY} ---`);
      await requestAndSignOperation(liberdusSecondary, OP_TYPES.SET_BRIDGE_IN_CALLER, BRIDGE_IN_CALLER_SECONDARY, 0, "0x");
      console.log("  Done.");
    }
  } else if (BRIDGE_IN_CALLER_SECONDARY) {
    console.log(`\nWarning: Invalid BRIDGE_IN_CALLER_SECONDARY address: ${BRIDGE_IN_CALLER_SECONDARY}`);
  }

  // ====================================================
  // 3. BRIDGE DIRECTION FLAGS
  // ====================================================
  const desiredBridgeInEnabled = parseOptionalBoolean(SECONDARY_BRIDGE_IN_ENABLED, "SECONDARY_BRIDGE_IN_ENABLED");
  if (desiredBridgeInEnabled !== null) {
    const currentBridgeInEnabled = await liberdusSecondary.bridgeInEnabled();
    if (currentBridgeInEnabled === desiredBridgeInEnabled) {
      console.log(`bridgeInEnabled already ${desiredBridgeInEnabled}, skipping.`);
    } else {
      console.log(`--- Setting bridgeInEnabled to ${desiredBridgeInEnabled} ---`);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [desiredBridgeInEnabled]);
      await requestAndSignOperation(liberdusSecondary, OP_TYPES.SET_BRIDGE_IN_ENABLED, ethers.ZeroAddress, 0, data);
      console.log("  Done.");
    }
  }

  const desiredBridgeOutEnabled = parseOptionalBoolean(SECONDARY_BRIDGE_OUT_ENABLED, "SECONDARY_BRIDGE_OUT_ENABLED");
  if (desiredBridgeOutEnabled !== null) {
    const currentBridgeOutEnabled = await liberdusSecondary.bridgeOutEnabled();
    if (currentBridgeOutEnabled === desiredBridgeOutEnabled) {
      console.log(`bridgeOutEnabled already ${desiredBridgeOutEnabled}, skipping.`);
    } else {
      console.log(`--- Setting bridgeOutEnabled to ${desiredBridgeOutEnabled} ---`);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [desiredBridgeOutEnabled]);
      await requestAndSignOperation(liberdusSecondary, OP_TYPES.SET_BRIDGE_OUT_ENABLED, ethers.ZeroAddress, 0, data);
      console.log("  Done.");
    }
  }

  console.log("\n--- Setup Complete ---");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
