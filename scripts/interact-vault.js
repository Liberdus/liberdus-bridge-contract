const hre = require("hardhat");
const { ethers } = hre;

async function requestAndSignOperation(contract, signers, operationType, target, value, data) {
  const tx = await contract.requestOperation(operationType, target, value, data);
  const receipt = await tx.wait();

  const operationRequestedEvent = receipt.logs.find(log => log.fragment && log.fragment.name === 'OperationRequested');
  const operationId = operationRequestedEvent.args.operationId;

  console.log(`  Operation requested: ${operationId}`);

  for (let i = 0; i < 3; i++) {
    const messageHash = await contract.getOperationHash(operationId);
    const signature = await signers[i].signMessage(ethers.getBytes(messageHash));
    await contract.connect(signers[i]).submitSignature(operationId, signature);
    console.log(`  Signature ${i + 1}/3 submitted by ${signers[i].address}`);
  }

  console.log(`  Operation executed.`);
  return operationId;
}

async function main() {
  const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
  const LIBERDUS_ADDRESS = process.env.LIBERDUS_TOKEN_ADDRESS;
  const ACTION = process.env.ACTION || "balance"; // balance, bridgeOut, bridgeIn, relinquish, setBridgeInCaller, pause, unpause

  if (!VAULT_ADDRESS) {
    throw new Error("Set VAULT_ADDRESS in your .env file");
  }

  const allSigners = await hre.ethers.getSigners();
  const [deployer, signer1, signer2, signer3] = allSigners;
  const signers = [deployer, signer1, signer2, signer3];
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  console.log("=== Vault Interaction ===");
  console.log("Vault Address:", VAULT_ADDRESS);
  console.log("Chain ID:", Number(chainId));
  console.log("Action:", ACTION);
  console.log("Deployer:", deployer.address);

  const vault = await hre.ethers.getContractAt("Vault", VAULT_ADDRESS);

  // --- BALANCE CHECK ---
  if (ACTION === "balance") {
    const vaultBalance = await vault.getVaultBalance();
    console.log(`\nVault Balance: ${ethers.formatUnits(vaultBalance, 18)} LIB`);

    const bridgeInCaller = await vault.bridgeInCaller();
    console.log(`Bridge In Caller: ${bridgeInCaller}`);

    const maxBridgeInAmount = await vault.maxBridgeInAmount();
    console.log(`Max Bridge In Amount: ${ethers.formatUnits(maxBridgeInAmount, 18)} LIB`);

    const bridgeInCooldown = await vault.bridgeInCooldown();
    console.log(`Bridge In Cooldown: ${Number(bridgeInCooldown)}s`);

    for (const account of [
      { name: "Deployer", address: deployer.address },
      { name: "Signer 1", address: signer1.address },
      { name: "Signer 2", address: signer2.address },
      { name: "Signer 3", address: signer3.address },
    ]) {
      const isSigner = await vault.isSigner(account.address);
      console.log(`${account.name} (${account.address}): isSigner=${isSigner}`);
    }
    return;
  }

  // --- BRIDGE OUT ---
  if (ACTION === "bridgeOut") {
    if (!LIBERDUS_ADDRESS) {
      throw new Error("Set LIBERDUS_TOKEN_ADDRESS in your .env file");
    }

    const liberdus = await hre.ethers.getContractAt("Liberdus", LIBERDUS_ADDRESS);
    const amount = ethers.parseUnits(process.env.AMOUNT || "100", 18);
    const targetAddress = process.env.TARGET_ADDRESS || deployer.address;
    const destinationChainId = process.env.DESTINATION_CHAIN_ID || 0;

    const balance = await liberdus.balanceOf(deployer.address);
    console.log(`\nCurrent Balance: ${ethers.formatUnits(balance, 18)} LIB`);

    if (balance < amount) {
      throw new Error(`Insufficient balance. Have ${ethers.formatUnits(balance, 18)}, need ${ethers.formatUnits(amount, 18)}`);
    }

    // Approve vault
    console.log(`Approving vault for ${ethers.formatUnits(amount, 18)} LIB...`);
    const approveTx = await liberdus.connect(deployer).approve(VAULT_ADDRESS, amount);
    await approveTx.wait();

    // Bridge out
    console.log(`Bridging out ${ethers.formatUnits(amount, 18)} LIB to ${targetAddress}...`);
    const tx = await vault.connect(deployer)["bridgeOut(uint256,address,uint256,uint256)"](amount, targetAddress, chainId, destinationChainId);
    const receipt = await tx.wait();
    console.log("Transaction hash:", receipt.hash);

    const newBalance = await liberdus.balanceOf(deployer.address);
    console.log(`New Balance: ${ethers.formatUnits(newBalance, 18)} LIB`);
    console.log(`Vault Balance: ${ethers.formatUnits(await vault.getVaultBalance(), 18)} LIB`);
    return;
  }

  // --- BRIDGE IN ---
  if (ACTION === "bridgeIn") {
    const recipient = process.env.RECIPIENT || deployer.address;
    const amount = ethers.parseUnits(process.env.AMOUNT || "100", 18);
    const txId = process.env.TX_ID || ethers.id(`bridge-in-${Date.now()}`);
    const sourceChainId = process.env.SOURCE_CHAIN_ID || 0;

    console.log(`\nBridging in ${ethers.formatUnits(amount, 18)} LIB to ${recipient}...`);
    console.log(`TX ID: ${txId}`);

    const tx = await vault.connect(deployer)["bridgeIn(address,uint256,uint256,bytes32,uint256)"](recipient, amount, chainId, txId, sourceChainId);
    const receipt = await tx.wait();
    console.log("Transaction hash:", receipt.hash);
    console.log(`Vault Balance: ${ethers.formatUnits(await vault.getVaultBalance(), 18)} LIB`);
    return;
  }

  // --- SET BRIDGE IN CALLER ---
  if (ACTION === "setBridgeInCaller") {
    const newCaller = process.env.BRIDGE_IN_CALLER;
    if (!newCaller) {
      throw new Error("Set BRIDGE_IN_CALLER in your .env file");
    }

    console.log(`\nSetting bridge in caller to ${newCaller}...`);
    // SetBridgeInCaller is OperationType 2
    await requestAndSignOperation(vault, signers, 2, newCaller, 0, "0x");
    console.log(`Bridge In Caller set to: ${await vault.bridgeInCaller()}`);
    return;
  }

  // --- RELINQUISH TOKENS ---
  if (ACTION === "relinquish") {
    const vaultBalance = await vault.getVaultBalance();
    console.log(`\nVault Balance: ${ethers.formatUnits(vaultBalance, 18)} LIB`);
    console.log("Relinquishing all tokens to Liberdus contract...");

    // RelinquishTokens is OperationType 5
    await requestAndSignOperation(vault, signers, 5, ethers.ZeroAddress, 0, "0x");

    console.log(`Vault Balance after relinquish: ${ethers.formatUnits(await vault.getVaultBalance(), 18)} LIB`);
    return;
  }

  // --- PAUSE ---
  if (ACTION === "pause") {
    console.log("\nPausing vault...");
    // Pause is OperationType 0
    await requestAndSignOperation(vault, signers, 0, ethers.ZeroAddress, 0, "0x");
    console.log("Vault paused.");
    return;
  }

  // --- UNPAUSE ---
  if (ACTION === "unpause") {
    console.log("\nUnpausing vault...");
    // Unpause is OperationType 1
    await requestAndSignOperation(vault, signers, 1, ethers.ZeroAddress, 0, "0x");
    console.log("Vault unpaused.");
    return;
  }

  console.error(`Unknown action: ${ACTION}. Use one of: balance, bridgeOut, bridgeIn, setBridgeInCaller, relinquish, pause, unpause`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
