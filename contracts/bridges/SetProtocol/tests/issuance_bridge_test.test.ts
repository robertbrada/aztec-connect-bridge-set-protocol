// yarn test bridges/SetProtocol

import { expect as expectRevert } from "chai";
import { ethers } from "hardhat";
import DefiBridgeProxy from "../../../../src/artifacts/contracts/DefiBridgeProxy.sol/DefiBridgeProxy.json";
import { Contract, Signer, ContractFactory } from "ethers";
import {
  TestToken,
  AztecAssetType,
  AztecAsset,
  RollupProcessor,
} from "../../../../src/rollup_processor";

import { IssuanceBridge } from "../../../../typechain-types";

import { randomBytes } from "crypto";

const fixEthersStackTrace = (err: Error) => {
  err.stack! += new Error().stack;
  throw err;
};

describe("defi bridge", function () {
  let rollupContract: RollupProcessor;
  let defiBridgeProxy: Contract;

  // mainnet addresses
  const exchangeIssuanceAddress = "0xc8C85A3b4d03FB3451e7248Ff94F780c92F884fD";
  const setControllerAddress = "0xa4c8d221d8bb851f83aadd0223a8900a6921a349";
  const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
  const dpiAddress = "0x1494CA1F11D487c2bBe4543E90080AeBa4BA3C2b";
  const uniAddress = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";

  let signer: Signer;
  let issuanceBridgeContract: IssuanceBridge;

  beforeAll(async () => {
    [signer] = await ethers.getSigners();

    const factory = new ContractFactory(
      DefiBridgeProxy.abi,
      DefiBridgeProxy.bytecode,
      signer
    );
    defiBridgeProxy = await factory.deploy([]);
    rollupContract = await RollupProcessor.deploy(signer, [
      defiBridgeProxy.address,
    ]);
  });

  beforeEach(async () => {
    // deploy the bridge and pass in any args
    const setFactory = await ethers.getContractFactory("IssuanceBridge");

    issuanceBridgeContract = await setFactory.deploy(
      rollupContract.address,
      exchangeIssuanceAddress,
      setControllerAddress
    );
    await issuanceBridgeContract.deployed();
  });

  it("Should revert when no SetToken in input/output", async () => {
    console.log("=== Should revert when no SetToken in input/output ===");
    const inputAsset = {
      assetId: 1,
      erc20Address: daiAddress,
      assetType: AztecAssetType.ERC20,
    };
    const outputAsset = {
      assetId: 2,
      erc20Address: uniAddress,
      assetType: AztecAssetType.ERC20,
    };

    const quantityOfDaiToDeposit = 1n * 10n ** 21n; // 1000
    // get DAI into the rollup contract
    await rollupContract.preFundContractWithToken(signer, {
      erc20Address: daiAddress,
      amount: quantityOfDaiToDeposit,
      name: "DAI",
    });

    // https://stackoverflow.com/questions/68014834/property-does-not-exist-on-type-jestmatchers
    await expectRevert(
      rollupContract.convert(
        signer,
        issuanceBridgeContract.address,
        inputAsset,
        {},
        outputAsset,
        {},
        quantityOfDaiToDeposit,
        0n,
        0n
      )
    ).to.be.reverted;
  });

  it("Should issue SetToken for ERC20 (DPI for DAI)", async () => {
    console.log("=== Should issue SetToken for ERC20 (DPI for DAI) ===");
    const inputAsset = {
      assetId: 1,
      erc20Address: daiAddress,
      assetType: AztecAssetType.ERC20,
    };
    const outputAsset = {
      assetId: 2,
      erc20Address: dpiAddress,
      assetType: AztecAssetType.ERC20,
    };

    const DAIContract = await ethers.getContractAt("ERC20", daiAddress, signer);
    const DPIContract = await ethers.getContractAt("ERC20", dpiAddress, signer);

    const before = {
      rollupContract: {
        DAI: BigInt(await DAIContract.balanceOf(rollupContract.address)),
        DPI: BigInt(await DPIContract.balanceOf(rollupContract.address)),
      },
      bridgeContract: {
        DAI: BigInt(
          await DAIContract.balanceOf(issuanceBridgeContract.address)
        ),
        DPI: BigInt(
          await DPIContract.balanceOf(issuanceBridgeContract.address)
        ),
      },
    };

    console.log("before", before);

    // amount of DAI deposited in the previous test (that tx. should revert and no DAI should be spent)
    const daiToConvert = 1n * 10n ** 21n;

    const { outputValueA } = await rollupContract.convert(
      signer,
      issuanceBridgeContract.address,
      inputAsset,
      {},
      outputAsset,
      {},
      daiToConvert,
      0n,
      0n
    );

    const after = {
      rollupContract: {
        DAI: BigInt(await DAIContract.balanceOf(rollupContract.address)),
        DPI: BigInt(await DPIContract.balanceOf(rollupContract.address)),
      },
      bridgeContract: {
        DAI: BigInt(
          await DAIContract.balanceOf(issuanceBridgeContract.address)
        ),
        DPI: BigInt(
          await DPIContract.balanceOf(issuanceBridgeContract.address)
        ),
      },
    };

    console.log("after", after);

    expect(before.rollupContract.DAI).toBe(daiToConvert);
    expect(before.rollupContract.DPI).toBe(0n);
    expect(after.rollupContract.DAI).toBe(0n);
    expect(after.rollupContract.DPI).toBeGreaterThan(0);
    expect(after.rollupContract.DPI).toBe(outputValueA);
  });

  it("Should redeem SetToken for ERC20 (DPI for DAI)", async () => {
    console.log("=== Should redeem SetToken for ERC20 (DPI for DAI) ===");
    const inputAsset = {
      assetId: 1,
      erc20Address: dpiAddress,
      assetType: AztecAssetType.ERC20,
    };
    const outputAsset = {
      assetId: 2,
      erc20Address: daiAddress,
      assetType: AztecAssetType.ERC20,
    };

    const DAIContract = await ethers.getContractAt("ERC20", daiAddress, signer);
    const DPIContract = await ethers.getContractAt("ERC20", dpiAddress, signer);

    const before = {
      rollupContract: {
        DAI: BigInt(await DAIContract.balanceOf(rollupContract.address)),
        DPI: BigInt(await DPIContract.balanceOf(rollupContract.address)),
        ETH: BigInt(await ethers.provider.getBalance(rollupContract.address)),
      },
      bridgeContract: {
        DAI: BigInt(
          await DAIContract.balanceOf(issuanceBridgeContract.address)
        ),
        DPI: BigInt(
          await DPIContract.balanceOf(issuanceBridgeContract.address)
        ),
        ETH: BigInt(
          await ethers.provider.getBalance(issuanceBridgeContract.address)
        ),
      },
    };

    console.log("before", before);

   const { outputValueA } = await rollupContract.convert(
      signer,
      issuanceBridgeContract.address,
      inputAsset,
      {},
      outputAsset,
      {},
      before.rollupContract.DPI,
      0n,
      0n
    );

    const after = {
      rollupContract: {
        DAI: BigInt(await DAIContract.balanceOf(rollupContract.address)),
        DPI: BigInt(await DPIContract.balanceOf(rollupContract.address)),
        ETH: BigInt(await ethers.provider.getBalance(rollupContract.address)),
      },
      bridgeContract: {
        DAI: BigInt(
          await DAIContract.balanceOf(issuanceBridgeContract.address)
        ),
        DPI: BigInt(
          await DPIContract.balanceOf(issuanceBridgeContract.address)
        ),
        ETH: BigInt(
          await ethers.provider.getBalance(issuanceBridgeContract.address)
        ),
      },
    };

    console.log("after", after);

    expect(before.rollupContract.DAI).toBe(0n); // we swapped all DAI to DPI in the previous test
    expect(before.rollupContract.DPI).toBeGreaterThan(0n);
    expect(after.rollupContract.DAI).toBeGreaterThan(0n);
    expect(after.rollupContract.DAI).toBe(outputValueA);
// TODO compute more precise expected amount of DPI received
  });

  it("Should issue SetToken for ETH (DPI for ETH)", async () => {
    console.log("=== Should buy SetToken for ETH (DPI for ETH) ===");

    const inputAsset = {
      assetId: 1,
      erc20Address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      assetType: AztecAssetType.ETH,
    };
    const outputAsset = {
      assetId: 2,
      erc20Address: dpiAddress,
      assetType: AztecAssetType.ERC20,
    };

    const DPIContract = await ethers.getContractAt("ERC20", dpiAddress, signer);

    // pre-fund contract with ETH
    const quantityOfEthToDeposit = ethers.utils.parseEther("1");
    rollupContract.receiveEthFromBridge(signer, 0n, quantityOfEthToDeposit);

    const quantityOfEthToConvert = ethers.utils.parseEther("0.2");

    // Get ETH and DPI balances before convert()
    const before = {
      rollupContract: {
        DPI: BigInt(await DPIContract.balanceOf(rollupContract.address)),
        ETH: BigInt(await ethers.provider.getBalance(rollupContract.address)),
      },
      bridgeContract: {
        DPI: BigInt(
          await DPIContract.balanceOf(issuanceBridgeContract.address)
        ),
        ETH: BigInt(
          await ethers.provider.getBalance(issuanceBridgeContract.address)
        ),
      },
    };

    console.log("before", before);

    const { outputValueA } = await rollupContract.convert(
      signer,
      issuanceBridgeContract.address,
      inputAsset,
      {},
      outputAsset,
      {},
      BigInt(quantityOfEthToConvert),
      0n,
      0n
    );

    const after = {
      rollupContract: {
        DPI: BigInt(await DPIContract.balanceOf(rollupContract.address)),
        ETH: BigInt(await ethers.provider.getBalance(rollupContract.address)),
      },
      bridgeContract: {
        DPI: BigInt(
          await DPIContract.balanceOf(issuanceBridgeContract.address)
        ),
        ETH: BigInt(
          await ethers.provider.getBalance(issuanceBridgeContract.address)
        ),
      },
    };

    console.log("after", after);

    expect(before.rollupContract.ETH).toBe(1000000000000000000n); // 1 ETH
    expect(before.rollupContract.DPI).toBe(0n);
    expect(after.rollupContract.ETH).toBe(800000000000000000n); // 0.8 ETH (quantityOfEthToDeposit - quantityOfEthToConvert)
    expect(after.rollupContract.DPI).toBeGreaterThan(0n);
    expect(after.rollupContract.DPI).toBe(outputValueA);
  });
});
