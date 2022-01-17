import { Provider, Web3Provider } from "@ethersproject/providers";
import { Contract, ContractFactory, Signer } from "ethers";
import abi from "./artifacts/contracts/DefiBridgeProxy.sol/DefiBridgeProxy.json";

import UniswapV3Router03Json from "@uniswap/swap-router-contracts/artifacts/contracts/interfaces/IV3SwapRouter.sol/IV3SwapRouter.json";
import UniswapMulticallJson from "@uniswap/swap-router-contracts/artifacts/contracts/interfaces/IMulticallExtended.sol/IMulticallExtended.json";
import UniswapPaymentsJson from "@uniswap/swap-router-contracts/artifacts/contracts/interfaces/IPeripheryPaymentsExtended.sol/IPeripheryPaymentsExtended.json";

import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";

export interface SendTxOptions {
  gasPrice?: bigint;
  gasLimit?: number;
}

const assetToArray = (asset: AztecAsset) => [
  asset.id || 0,
  asset.erc20Address || "0x0000000000000000000000000000000000000000",
  asset.assetType || 0,
];

export enum AztecAssetType {
  NOT_USED,
  ETH,
  ERC20,
  VIRTUAL,
}

export interface AztecAsset {
  id?: number;
  assetType?: AztecAssetType;
  erc20Address?: string;
}

export interface Token {
  amount: number;
  erc20Address: string;
}

export class DefiBridgeProxy {
  private contract: Contract;
  private uniswapContract: Contract;
  private uniswapMultiCall: Contract;
  private uniswapPaymentsContract: Contract;
  private WETH9: string;

  constructor(public address: string, provider: Provider) {
    this.contract = new Contract(this.address, abi.abi, provider);
    this.WETH9 = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

    this.uniswapContract = new Contract(
      "0xe592427a0aece92de3edee1f18e0157c05861564",
      UniswapV3Router03Json.abi,
      provider
    );
    this.uniswapMultiCall = new Contract(
      "0xe592427a0aece92de3edee1f18e0157c05861564",
      UniswapMulticallJson.abi,
      provider
    );
    this.uniswapPaymentsContract = new Contract(
      "0xe592427a0aece92de3edee1f18e0157c05861564",
      UniswapPaymentsJson.abi,
      provider
    );
  }

  static async deploy(signer: Signer) {
    const factory = new ContractFactory(abi.abi, abi.bytecode, signer);
    const contract = await factory.deploy();
    return new DefiBridgeProxy(contract.address, signer.provider!);
  }

  async deployBridge(signer: Signer, abi: any, args: any[]) {
    const factory = new ContractFactory(abi.abi, abi.bytecode, signer);
    const contract = await factory.deploy(this.contract.address, ...args);
    return contract.address;
  }

  async canFinalise(bridgeAddress: string, interactionNonce: number) {
    return await this.contract.canFinalise(bridgeAddress, interactionNonce);
  }

  async finalise(
    signer: Signer,
    bridgeAddress: string,
    inputAssetA: AztecAsset,
    inputAssetB: AztecAsset,
    outputAssetA: AztecAsset,
    outputAssetB: AztecAsset,
    interactionNonce: bigint,
    auxInputData: bigint,
    options: SendTxOptions = {}
  ) {
    const contract = new Contract(
      this.contract.address,
      this.contract.interface,
      signer
    );
    const { gasLimit, gasPrice } = options;
    const tx = await contract.finalise(
      bridgeAddress,
      assetToArray(inputAssetA),
      assetToArray(inputAssetB),
      assetToArray(outputAssetA),
      assetToArray(outputAssetB),
      interactionNonce,
      auxInputData,
      {
        gasLimit,
        gasPrice,
      }
    );
    const receipt = await tx.wait();

    const parsedLogs = receipt.logs
      .filter((l: any) => l.address == contract.address)
      .map((l: any) => contract.interface.parseLog(l));

    const { outputValueA, outputValueB, isAsync } = parsedLogs[0].args;

    return {
      isAsync,
      outputValueA: BigInt(outputValueA.toString()),
      outputValueB: BigInt(outputValueB.toString()),
    };
  }

  async convert(
    signer: Signer,
    bridgeAddress: string,
    inputAssetA: AztecAsset,
    inputAssetB: AztecAsset,
    outputAssetA: AztecAsset,
    outputAssetB: AztecAsset,
    totalInputValue: bigint,
    interactionNonce: bigint,
    auxInputData: bigint,
    options: SendTxOptions = {}
  ) {
    const contract = new Contract(
      this.contract.address,
      this.contract.interface,
      signer
    );
    const { gasLimit, gasPrice } = options;

    /* 1. In real life the rollup contract calls delegateCall on the defiBridgeProxy contract.

    The rollup contract has totalInputValue of inputAssetA and inputAssetB, it sends totalInputValue of both assets (if specified)  to the bridge contract.

    For a good developer UX we should do the same.

    */

    const tx = await contract.convert(
      bridgeAddress,
      assetToArray(inputAssetA),
      assetToArray(inputAssetB),
      assetToArray(outputAssetA),
      assetToArray(outputAssetB),
      totalInputValue,
      interactionNonce,
      auxInputData,
      { gasLimit, gasPrice }
    );
    const receipt = await tx.wait();

    const parsedLogs = receipt.logs
      .filter((l: any) => l.address == contract.address)
      .map((l: any) => contract.interface.parseLog(l));

    const { outputValueA, outputValueB, isAsync } = parsedLogs[0].args;

    return {
      isAsync,
      outputValueA: BigInt(outputValueA.toString()),
      outputValueB: BigInt(outputValueB.toString()),
    };
  }

  async preFundRollupWithTokens(signer: Signer, tokens: Token[]) {
    // we need to do a setup step here
    // assume that the passed in signer has unlimted ETH on our ganache mainnet fork.
    // we can use the mainnet uniswap address to swap from ETH to any token we require.
    // 1. we need to call exactOutputSingle which is a payble function on the UNIV3 router
    // V3 Router Address: 0xE592427A0AEce92De3Edee1F18E0157C05861564
    /*
     ISwapRouter.ExactOutputSingleParams memory params =
            ISwapRouter.ExactOutputSingleParams({
                tokenIn: WETH9,
                tokenOut: TBC,
                fee: poolFee,
                recipient: msg.sender,
                deadline: block.timestamp,
                amountOut: amountOut,
                amountInMaximum: amountInMaximum,
                sqrtPriceLimitX96: 0
            });

        // Executes the swap returning the amountIn needed to spend to receive the desired amountOut.
        amountIn = swapRouter.exactOutputSingle(params);
        WETH9= 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2

    */

    const WETH9Contract = new Contract(this.WETH9, ERC20.abi, signer);

    const approveWethTx = await WETH9Contract.approve(
      this.uniswapContract.address,
      10 ^ 18
    );
    await approveWethTx.wait();

    const asyncCalls = tokens.map(async (token: Token) => {
      // approve the tokens
      const tokenContract = new Contract(token.erc20Address, ERC20.abi, signer);
      const approveTokenTx = await tokenContract.approve(
        this.uniswapMultiCall.address,
        10 ^ 18
      );
      console.log(approveTokenTx);
      await approveTokenTx.wait();
      const params = {
        tokenOut: this.WETH9,
        tokenIn: token.erc20Address,
        fee: 3000,
        recipient: this.address,
        amountOut: 1,
        deadline: `0x${BigInt(
          Date.now() + 3600000000000000000000000000
        ).toString(16)}`,
        amountInMaximum: 1,
        sqrtPriceLimitX96: 0,
      };
      console.log(params);

      console.log("Prefunding Rollup with", token.erc20Address, token.amount);

      const data = [
        this.uniswapContract.interface.encodeFunctionData("exactOutputSingle", [
          params,
        ]),
      ];

      console.log(Object.values(params));

      data.push(
        this.uniswapPaymentsContract.interface.encodeFunctionData("refundETH")
      );
      console.log(data);
      // ensure that the swap fails if the limit is any tighter
      const uniswapRouter = new Contract(
        this.uniswapMultiCall.address,
        UniswapMulticallJson.abi,
        signer
      );

      const multiCallData = uniswapRouter.interface.encodeFunctionData(
        "multicall(bytes[])",
        [data]
      );
      console.log(multiCallData);

      const tx = await signer.sendTransaction({
        to: uniswapRouter.address,
        data: multiCallData,
        value: 100n,
      });
      console.log(tx);
    });
    await Promise.all(asyncCalls);
  }
}