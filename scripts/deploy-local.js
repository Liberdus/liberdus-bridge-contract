const hre = require("hardhat");
const { ZeroAddress } = require("hardhat").ethers;
const { ethers } = hre;

const SECONDARY_OP = Object.freeze({
  SET_BRIDGE_IN_CALLER: 0,
  SET_BRIDGE_OUT_ENABLED: 4,
});

async function main() {
  const [deployer, signer1, signer2, signer3] = await hre.ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log(
    "Account balance:",
    (await deployer.provider.getBalance(deployer.address)).toString(),
  );

  const CHAIN_ID_SECONDARY = 31338;

  let signerAddresses;
  let signers;

  if (hre.network.name === "hardhat" || hre.network.name === "localhost") {
    signerAddresses = [
      deployer.address,
      signer1.address,
      signer2.address,
      signer3.address,
    ];
    signers = [deployer, signer1, signer2, signer3];
  } else {
    signers = hre.config.namedAccounts.signers[hre.network.name];
    signerAddresses = signers;
  }

  // --- HELPER FUNCTION ---
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

  // ====================================================
  // 1. DEPLOY LIBERDUS SECONDARY
  // ====================================================
  console.log("\n--- Deploying LiberdusSecondary (Chain ID: 31338) ---");
  const LiberdusSecondaryToken = await hre.ethers.getContractFactory("LiberdusSecondary");
  const liberdusSecondary = await LiberdusSecondaryToken.deploy(signerAddresses, CHAIN_ID_SECONDARY);
  await liberdusSecondary.waitForDeployment();
  console.log(`LiberdusSecondary deployed to: ${await liberdusSecondary.getAddress()}`);

  // ====================================================
  // 2. SETUP: SET BRIDGE-IN CALLER
  // ====================================================
  console.log("\n--- Setting BridgeInCaller to deployer ---");
  await requestAndSignOperation(
    liberdusSecondary,
    SECONDARY_OP.SET_BRIDGE_IN_CALLER,
    deployer.address,
    0,
    "0x"
  );

  // Enable bridgeOut for local round-trip tests
  if (!(await liberdusSecondary.bridgeOutEnabled())) {
    console.log("Enabling bridgeOut...");
    const enableBridgeOutData = ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [true]);
    await requestAndSignOperation(
      liberdusSecondary,
      SECONDARY_OP.SET_BRIDGE_OUT_ENABLED,
      ZeroAddress,
      0,
      enableBridgeOutData
    );
  }

  // ====================================================
  // 3. INTERACTION: BRIDGE IN
  // ====================================================
  console.log("\n--- Interaction: Bridge In ---");
  const bridgeAmount = ethers.parseUnits("10000", 18);
  console.log(`Bridging in ${ethers.formatUnits(bridgeAmount, 18)} LIB to deployer...`);
  await liberdusSecondary.connect(deployer).bridgeIn(deployer.address, bridgeAmount, CHAIN_ID_SECONDARY, ethers.id("tx1"));
  console.log("Balance:", ethers.formatUnits(await liberdusSecondary.balanceOf(deployer.address), 18), "LIB");

  // ====================================================
  // 4. INTERACTION: BRIDGE OUT
  // ====================================================
  console.log("\n--- Interaction: Bridge Out ---");
  const returnAmount = ethers.parseUnits("200", 18);
  console.log(`Bridging out ${ethers.formatUnits(returnAmount, 18)} LIB...`);
  await liberdusSecondary.connect(deployer).bridgeOut(returnAmount, deployer.address, CHAIN_ID_SECONDARY);
  console.log("Balance:", ethers.formatUnits(await liberdusSecondary.balanceOf(deployer.address), 18), "LIB");

  console.log("\n--- Deployment Summary ---");
  console.log(`LIBERDUS_SECONDARY_ADDRESS=${await liberdusSecondary.getAddress()}`);
  console.log("\n--- DONE ---");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
