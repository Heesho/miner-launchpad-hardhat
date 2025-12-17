const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;

const AddressZero = "0x0000000000000000000000000000000000000000";

describe("Multicall-Only Tests (Frontend Simulation)", function () {
    let weth, donut, core, multicall;
    let rigFactory, auctionFactory, unitFactory;
    let uniswapFactory, uniswapRouter;
    let owner, protocol, team, user0, user1, user2, user3;

    async function getFutureDeadline() {
        const block = await ethers.provider.getBlock("latest");
        return block.timestamp + 86400 * 365;
    }

    async function increaseTime(seconds) {
        await network.provider.send("evm_increaseTime", [seconds]);
        await network.provider.send("evm_mine");
    }

    // Helper to parse Core__Launched event from Multicall transaction
    async function parseLaunchEvent(receipt) {
        const coreInterface = core.interface;
        for (const log of receipt.logs) {
            try {
                const parsed = coreInterface.parseLog(log);
                if (parsed.name === "Core__Launched") {
                    return parsed;
                }
            } catch (e) {
                // Not a Core event, skip
            }
        }
        return null;
    }

    before(async function () {
        await network.provider.send("hardhat_reset");

        [owner, protocol, team, user0, user1, user2, user3] = await ethers.getSigners();

        // Deploy base tokens
        const MockWETH = await ethers.getContractFactory("MockWETH");
        weth = await MockWETH.deploy();
        donut = await MockWETH.deploy();

        // Deploy Uniswap mocks
        const MockFactory = await ethers.getContractFactory("MockUniswapV2Factory");
        uniswapFactory = await MockFactory.deploy();

        const MockRouter = await ethers.getContractFactory("MockUniswapV2Router");
        uniswapRouter = await MockRouter.deploy(uniswapFactory.address);

        // Deploy factories
        const RigFactory = await ethers.getContractFactory("RigFactory");
        rigFactory = await RigFactory.deploy();

        const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
        auctionFactory = await AuctionFactory.deploy();

        const UnitFactory = await ethers.getContractFactory("UnitFactory");
        unitFactory = await UnitFactory.deploy();

        // Deploy Core
        const Core = await ethers.getContractFactory("Core");
        core = await Core.deploy(
            weth.address,
            donut.address,
            uniswapFactory.address,
            uniswapRouter.address,
            unitFactory.address,
            rigFactory.address,
            auctionFactory.address,
            protocol.address,
            convert("100", 18)
        );

        // Deploy Multicall
        const Multicall = await ethers.getContractFactory("Multicall");
        multicall = await Multicall.deploy(core.address, weth.address, donut.address);

        // Give users DONUT tokens (more for multiple launches)
        for (const user of [user0, user1, user2, user3]) {
            await donut.connect(user).deposit({ value: convert("5000", 18) });
        }
    });

    // ============================================================
    // LAUNCHING RIGS VIA MULTICALL
    // ============================================================
    describe("Launch via Multicall", function () {
        it("Can launch a rig through Multicall", async function () {
            const launchParams = {
                launcher: AddressZero, // Will be overwritten by Multicall
                tokenName: "Multicall Unit",
                tokenSymbol: "MUNIT",
                uri: "",
                donutAmount: convert("500", 18),
                unitAmount: convert("1000000", 18),
                initialUps: convert("4", 18),
                tailUps: convert("0.01", 18),
                halvingPeriod: 2592000,
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("2", 18),
                rigMinInitPrice: convert("0.0001", 18),
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.2", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            // Approve DONUT to Multicall
            await donut.connect(user0).approve(multicall.address, launchParams.donutAmount);

            // Launch via Multicall
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();

            // Get addresses from Core event (emitted by Core, not Multicall)
            const launchEvent = await parseLaunchEvent(receipt);
            expect(launchEvent).to.not.be.null;

            const rigAddr = launchEvent.args.rig;
            const unitAddr = launchEvent.args.unit;
            const auctionAddr = launchEvent.args.auction;

            // Verify rig ownership is user0 (not Multicall)
            const rig = await ethers.getContractAt("Rig", rigAddr);
            expect(await rig.owner()).to.equal(user0.address);

            // Verify registry
            expect(await core.rigToLauncher(rigAddr)).to.equal(user0.address);
            expect(await core.isDeployedRig(rigAddr)).to.be.true;
        });

        it("Launcher param is overwritten with msg.sender", async function () {
            const launchParams = {
                launcher: user3.address, // Try to set someone else as launcher
                tokenName: "Override Test",
                tokenSymbol: "OVRD",
                uri: "",
                donutAmount: convert("200", 18),
                unitAmount: convert("1000000", 18),
                initialUps: convert("1", 18),
                tailUps: convert("0.01", 18),
                halvingPeriod: 86400,
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.1", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await donut.connect(user1).approve(multicall.address, launchParams.donutAmount);
            const tx = await multicall.connect(user1).launch(launchParams);
            const receipt = await tx.wait();

            const launchEvent = await parseLaunchEvent(receipt);
            const rig = await ethers.getContractAt("Rig", launchEvent.args.rig);

            // Owner should be user1 (caller), not user3 (param)
            expect(await rig.owner()).to.equal(user1.address);
            expect(await core.rigToLauncher(launchEvent.args.rig)).to.equal(user1.address);
        });

        it("Reverts if DONUT not approved", async function () {
            const launchParams = {
                launcher: AddressZero,
                tokenName: "No Approve",
                tokenSymbol: "NOAP",
                uri: "",
                donutAmount: convert("200", 18),
                unitAmount: convert("1000000", 18),
                initialUps: convert("1", 18),
                tailUps: convert("0.01", 18),
                halvingPeriod: 86400,
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.1", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            // Don't approve
            await expect(
                multicall.connect(user2).launch(launchParams)
            ).to.be.reverted;
        });

        it("Reverts with insufficient DONUT balance", async function () {
            const launchParams = {
                launcher: AddressZero,
                tokenName: "No Balance",
                tokenSymbol: "NOBAL",
                uri: "",
                donutAmount: convert("10000", 18), // More than user has
                initialUps: convert("1", 18),
                tailUps: convert("0.01", 18),
                halvingPeriod: 86400,
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.1", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await donut.connect(user2).approve(multicall.address, launchParams.donutAmount);
            await expect(
                multicall.connect(user2).launch(launchParams)
            ).to.be.reverted;
        });
    });

    // ============================================================
    // MINING VIA MULTICALL
    // ============================================================
    describe("Mine via Multicall", function () {
        let rig, unit, auction;

        before(async function () {
            // Launch a fresh rig for mining tests
            const launchParams = {
                launcher: AddressZero,
                tokenName: "Mining Test Unit",
                tokenSymbol: "MTEST",
                uri: "",
                donutAmount: convert("300", 18),
                unitAmount: convert("1000000", 18),
                initialUps: convert("10", 18),
                tailUps: convert("0.1", 18),
                halvingPeriod: 86400,
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("2", 18),
                rigMinInitPrice: convert("0.001", 18),
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.2", 18),
                auctionMinInitPrice: convert("0.01", 18),
            };

            await donut.connect(user0).approve(multicall.address, launchParams.donutAmount);
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();

            const launchEvent = await parseLaunchEvent(receipt);
            rig = await ethers.getContractAt("Rig", launchEvent.args.rig);
            unit = await ethers.getContractAt("Unit", launchEvent.args.unit);
            auction = await ethers.getContractAt("Auction", launchEvent.args.auction);
        });

        it("Can mine with ETH (auto-wrapped to WETH)", async function () {
            const epochId = await rig.epochId();
            const price = await rig.getPrice();
            const deadline = await getFutureDeadline();

            const ethBalanceBefore = await ethers.provider.getBalance(user1.address);

            const tx = await multicall.connect(user1).mine(
                rig.address,
                epochId,
                deadline,
                price,
                "First mine via Multicall",
                { value: price.mul(2) } // Send extra ETH
            );

            expect(await rig.epochMiner()).to.equal(user1.address);
            expect(await rig.epochUri()).to.equal("First mine via Multicall");
        });

        it("Refunds excess ETH as WETH", async function () {
            const epochId = await rig.epochId();
            const price = await rig.getPrice();
            const deadline = await getFutureDeadline();

            const wethBalanceBefore = await weth.balanceOf(user2.address);
            const excessAmount = convert("1", 18);

            await multicall.connect(user2).mine(
                rig.address,
                epochId,
                deadline,
                price,
                "Excess refund test",
                { value: price.add(excessAmount) }
            );

            const wethBalanceAfter = await weth.balanceOf(user2.address);
            // Should have received refund as WETH (approximately the excess)
            expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.closeTo(excessAmount, excessAmount.div(100));
        });

        it("Previous miner receives Unit tokens after next mine", async function () {
            // user2 is current miner from previous test
            const unitBalanceBefore = await unit.balanceOf(user2.address);

            // Wait some time
            await increaseTime(1800);

            // user3 mines
            const epochId = await rig.epochId();
            const price = await rig.getPrice();
            const deadline = await getFutureDeadline();

            await multicall.connect(user3).mine(
                rig.address,
                epochId,
                deadline,
                price,
                "Trigger token mint",
                { value: price.mul(2) }
            );

            const unitBalanceAfter = await unit.balanceOf(user2.address);
            expect(unitBalanceAfter).to.be.gt(unitBalanceBefore);
        });

        it("Can mine at zero price with zero ETH", async function () {
            // Wait for price to decay to zero
            await increaseTime(3700);

            const epochId = await rig.epochId();
            const price = await rig.getPrice();
            expect(price).to.equal(0);

            const deadline = await getFutureDeadline();

            await multicall.connect(user1).mine(
                rig.address,
                epochId,
                deadline,
                0,
                "Free mine",
                { value: 0 }
            );

            expect(await rig.epochMiner()).to.equal(user1.address);
        });

        it("Reverts with wrong epochId", async function () {
            const wrongEpochId = 999;
            const price = await rig.getPrice();
            const deadline = await getFutureDeadline();

            await expect(
                multicall.connect(user2).mine(
                    rig.address,
                    wrongEpochId,
                    deadline,
                    price,
                    "Wrong epoch",
                    { value: convert("1", 18) }
                )
            ).to.be.revertedWith("Rig__EpochIdMismatch()");
        });

        it("Reverts with expired deadline", async function () {
            const epochId = await rig.epochId();
            const price = await rig.getPrice();
            const block = await ethers.provider.getBlock("latest");
            const pastDeadline = block.timestamp - 1;

            await expect(
                multicall.connect(user2).mine(
                    rig.address,
                    epochId,
                    pastDeadline,
                    price,
                    "Expired",
                    { value: convert("1", 18) }
                )
            ).to.be.revertedWith("Rig__Expired()");
        });

        it("Reverts with insufficient maxPrice", async function () {
            // Mine to set up new epoch with higher price
            const epochId = await rig.epochId();
            const price = await rig.getPrice();
            const deadline = await getFutureDeadline();

            await multicall.connect(user1).mine(
                rig.address,
                epochId,
                deadline,
                price.add(convert("1", 18)),
                "Setup",
                { value: convert("2", 18) }
            );

            // Now try with maxPrice = 0
            const newEpochId = await rig.epochId();
            const newPrice = await rig.getPrice();

            if (newPrice.gt(0)) {
                await expect(
                    multicall.connect(user2).mine(
                        rig.address,
                        newEpochId,
                        deadline,
                        0, // maxPrice = 0
                        "Should fail",
                        { value: convert("1", 18) }
                    )
                ).to.be.revertedWith("Rig__MaxPriceExceeded()");
            }
        });
    });

    // ============================================================
    // READING STATE VIA MULTICALL
    // ============================================================
    describe("Read State via Multicall", function () {
        let rig, unit, auction, lpToken;

        before(async function () {
            // Launch a fresh rig
            const launchParams = {
                launcher: AddressZero,
                tokenName: "State Test Unit",
                tokenSymbol: "STATE",
                uri: "",
                donutAmount: convert("400", 18),
                unitAmount: convert("1000000", 18),
                initialUps: convert("5", 18),
                tailUps: convert("0.05", 18),
                halvingPeriod: 86400 * 7,
                rigEpochPeriod: 1800,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0005", 18),
                auctionInitPrice: convert("2", 18),
                auctionEpochPeriod: 43200,
                auctionPriceMultiplier: convert("1.3", 18),
                auctionMinInitPrice: convert("0.005", 18),
            };

            await donut.connect(user0).approve(multicall.address, launchParams.donutAmount);
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();

            const launchEvent = await parseLaunchEvent(receipt);
            rig = await ethers.getContractAt("Rig", launchEvent.args.rig);
            unit = await ethers.getContractAt("Unit", launchEvent.args.unit);
            auction = await ethers.getContractAt("Auction", launchEvent.args.auction);
            lpToken = await ethers.getContractAt("IERC20", launchEvent.args.lpToken);
        });

        it("getRig returns correct initial state", async function () {
            const state = await multicall.getRig(rig.address, user1.address);

            expect(state.epochId).to.equal(0);
            expect(state.initPrice).to.equal(await rig.epochInitPrice());
            expect(state.epochStartTime).to.equal(await rig.epochStartTime());
            expect(state.ups).to.equal(await rig.epochUps());
            expect(state.miner).to.equal(await rig.epochMiner());
            expect(state.epochUri).to.equal(await rig.epochUri());
        });

        it("getRig returns correct user balances", async function () {
            const state = await multicall.getRig(rig.address, user1.address);

            expect(state.ethBalance).to.equal(await ethers.provider.getBalance(user1.address));
            expect(state.wethBalance).to.equal(await weth.balanceOf(user1.address));
            expect(state.donutBalance).to.equal(await donut.balanceOf(user1.address));
            expect(state.unitBalance).to.equal(await unit.balanceOf(user1.address));
        });

        it("getRig returns zero balances for zero address", async function () {
            const state = await multicall.getRig(rig.address, AddressZero);

            expect(state.ethBalance).to.equal(0);
            expect(state.wethBalance).to.equal(0);
            expect(state.donutBalance).to.equal(0);
            expect(state.unitBalance).to.equal(0);
        });

        it("getRig price decays correctly", async function () {
            const stateBefore = await multicall.getRig(rig.address, user1.address);
            const priceBefore = stateBefore.price;

            await increaseTime(900); // Half epoch

            const stateAfter = await multicall.getRig(rig.address, user1.address);
            const priceAfter = stateAfter.price;

            // Price should be approximately half
            expect(priceAfter).to.be.lt(priceBefore);
            expect(priceAfter).to.be.closeTo(priceBefore.div(2), priceBefore.div(10));
        });

        it("getRig glazed increases over time", async function () {
            // Mine first to set a miner
            const epochId = await rig.epochId();
            const price = await rig.getPrice();
            const deadline = await getFutureDeadline();

            await multicall.connect(user1).mine(
                rig.address,
                epochId,
                deadline,
                price.mul(2),
                "For glazed test",
                { value: price.mul(2) }
            );

            const stateBefore = await multicall.getRig(rig.address, user1.address);

            await increaseTime(100);

            const stateAfter = await multicall.getRig(rig.address, user1.address);

            expect(stateAfter.glazed).to.be.gt(stateBefore.glazed);
        });

        it("getRig nextUps reflects halvings", async function () {
            const stateBefore = await multicall.getRig(rig.address, user1.address);
            const upsBefore = stateBefore.nextUps;

            // Jump past halving period (7 days)
            await increaseTime(86400 * 7 + 1);

            const stateAfter = await multicall.getRig(rig.address, user1.address);
            const upsAfter = stateAfter.nextUps;

            expect(upsAfter).to.equal(upsBefore.div(2));
        });

        it("getAuction returns correct initial state", async function () {
            const state = await multicall.getAuction(rig.address, user1.address);

            expect(state.epochId).to.equal(await auction.epochId());
            expect(state.initPrice).to.equal(await auction.initPrice());
            expect(state.startTime).to.equal(await auction.startTime());
            expect(state.paymentToken).to.equal(await auction.paymentToken());
        });

        it("getAuction returns correct user balances", async function () {
            const state = await multicall.getAuction(rig.address, user1.address);

            expect(state.wethBalance).to.equal(await weth.balanceOf(user1.address));
            expect(state.donutBalance).to.equal(await donut.balanceOf(user1.address));
            expect(state.paymentTokenBalance).to.equal(await lpToken.balanceOf(user1.address));
        });

        it("getAuction wethAccumulated increases after mining", async function () {
            const stateBefore = await multicall.getAuction(rig.address, user1.address);

            // Mine to generate fees for treasury (auction)
            const epochId = await rig.epochId();
            const deadline = await getFutureDeadline();

            // Wait for reasonable price
            await increaseTime(1700);
            const price = await rig.getPrice();

            if (price.gt(0)) {
                await multicall.connect(user2).mine(
                    rig.address,
                    epochId,
                    deadline,
                    price.mul(2),
                    "Generate fees",
                    { value: price.mul(2) }
                );

                const stateAfter = await multicall.getAuction(rig.address, user1.address);
                expect(stateAfter.wethAccumulated).to.be.gt(stateBefore.wethAccumulated);
            }
        });

        it("getRig unitPrice calculated from LP reserves", async function () {
            const state = await multicall.getRig(rig.address, user1.address);

            // unitPrice = donutInLP * 1e18 / unitInLP
            const donutInLP = await donut.balanceOf(lpToken.address);
            const unitInLP = await unit.balanceOf(lpToken.address);

            if (unitInLP.gt(0)) {
                const expectedPrice = donutInLP.mul(convert("1", 18)).div(unitInLP);
                expect(state.unitPrice).to.be.closeTo(expectedPrice, expectedPrice.div(100));
            }
        });

        it("getAuction paymentTokenPrice calculated correctly", async function () {
            const state = await multicall.getAuction(rig.address, user1.address);

            // paymentTokenPrice = donutInLP * 2e18 / lpTotalSupply
            const donutInLP = await donut.balanceOf(lpToken.address);
            const lpTotalSupply = await lpToken.totalSupply();

            if (lpTotalSupply.gt(0)) {
                const expectedPrice = donutInLP.mul(2).mul(convert("1", 18)).div(lpTotalSupply);
                expect(state.paymentTokenPrice).to.be.closeTo(expectedPrice, expectedPrice.div(100));
            }
        });
    });

    // ============================================================
    // BUYING FROM AUCTION VIA MULTICALL
    // ============================================================
    describe("Buy from Auction via Multicall", function () {
        let rig, unit, auction, lpToken;

        beforeEach(async function () {
            // Launch a fresh rig for each test
            const launchParams = {
                launcher: AddressZero,
                tokenName: "Buy Test Unit",
                tokenSymbol: "BUYTEST",
                uri: "",
                donutAmount: convert("300", 18),
                unitAmount: convert("1000000", 18),
                initialUps: convert("5", 18),
                tailUps: convert("0.05", 18),
                halvingPeriod: 86400,
                rigEpochPeriod: 1800,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.001", 18),
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 3600,
                auctionPriceMultiplier: convert("1.2", 18),
                auctionMinInitPrice: convert("0.01", 18),
            };

            await donut.connect(user0).approve(multicall.address, launchParams.donutAmount);
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();

            const launchEvent = await parseLaunchEvent(receipt);
            rig = await ethers.getContractAt("Rig", launchEvent.args.rig);
            unit = await ethers.getContractAt("Unit", launchEvent.args.unit);
            auction = await ethers.getContractAt("Auction", launchEvent.args.auction);
            lpToken = await ethers.getContractAt("MockLP", launchEvent.args.lpToken);

            // Generate some WETH in the auction via mining
            const epochId = await rig.epochId();
            const price = await rig.getPrice();
            const deadline = await getFutureDeadline();

            await multicall.connect(user1).mine(
                rig.address,
                epochId,
                deadline,
                price.mul(2),
                "Generate auction fees",
                { value: price.mul(2) }
            );
        });

        it("Can buy from auction at zero price", async function () {
            // Wait for auction price to decay to zero
            await increaseTime(3700);

            const epochId = await auction.epochId();
            const price = await auction.getPrice();
            expect(price).to.equal(0);

            const wethBefore = await weth.balanceOf(user2.address);
            const auctionWeth = await weth.balanceOf(auction.address);

            const deadline = await getFutureDeadline();

            // Buy via Multicall (at zero price, no LP needed)
            await multicall.connect(user2).buy(
                rig.address,
                epochId,
                deadline,
                0
            );

            const wethAfter = await weth.balanceOf(user2.address);
            expect(wethAfter.sub(wethBefore)).to.equal(auctionWeth);
        });

        it("Buy requires LP token approval to Multicall", async function () {
            const epochId = await auction.epochId();
            const price = await auction.getPrice();
            const deadline = await getFutureDeadline();

            if (price.gt(0)) {
                // Mint LP tokens but don't approve
                await lpToken.mint(user3.address, price);

                await expect(
                    multicall.connect(user3).buy(
                        rig.address,
                        epochId,
                        deadline,
                        price.mul(2)
                    )
                ).to.be.reverted;
            }
        });

        it("Reverts with wrong epochId", async function () {
            const wrongEpochId = 999;
            const deadline = await getFutureDeadline();
            const price = await auction.getPrice();

            // Need to have LP tokens approved so we can test the epochId error
            await lpToken.mint(user2.address, price.add(convert("10", 18)));
            await lpToken.connect(user2).approve(multicall.address, price.add(convert("10", 18)));

            await expect(
                multicall.connect(user2).buy(
                    rig.address,
                    wrongEpochId,
                    deadline,
                    convert("10", 18)
                )
            ).to.be.revertedWith("Auction__EpochIdMismatch()");
        });

        it("Reverts with expired deadline", async function () {
            const epochId = await auction.epochId();
            const block = await ethers.provider.getBlock("latest");
            const pastDeadline = block.timestamp - 1;
            const price = await auction.getPrice();

            // Need to have LP tokens approved so we can test the deadline error
            await lpToken.mint(user2.address, price.add(convert("10", 18)));
            await lpToken.connect(user2).approve(multicall.address, price.add(convert("10", 18)));

            await expect(
                multicall.connect(user2).buy(
                    rig.address,
                    epochId,
                    pastDeadline,
                    convert("10", 18)
                )
            ).to.be.revertedWith("Auction__DeadlinePassed()");
        });
    });

    // ============================================================
    // FULL LIFECYCLE VIA MULTICALL ONLY
    // ============================================================
    describe("Full Lifecycle via Multicall Only", function () {
        it("Complete flow: launch -> mine -> earn tokens -> read state", async function () {
            // 1. Launch via Multicall
            const launchParams = {
                launcher: AddressZero,
                tokenName: "Lifecycle Test",
                tokenSymbol: "LIFE",
                uri: "",
                donutAmount: convert("500", 18),
                unitAmount: convert("1000000", 18),
                initialUps: convert("100", 18),
                tailUps: convert("1", 18),
                halvingPeriod: 86400,
                rigEpochPeriod: 600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 3600,
                auctionPriceMultiplier: convert("1.2", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await donut.connect(user0).approve(multicall.address, launchParams.donutAmount);
            const launchTx = await multicall.connect(user0).launch(launchParams);
            const launchReceipt = await launchTx.wait();
            const launchEvent = await parseLaunchEvent(launchReceipt);
            expect(launchEvent).to.not.be.null;

            const rigAddr = launchEvent.args.rig;
            const unitAddr = launchEvent.args.unit;
            const auctionAddr = launchEvent.args.auction;
            const rig = await ethers.getContractAt("Rig", rigAddr);
            const unit = await ethers.getContractAt("Unit", unitAddr);

            // 2. Read initial state via Multicall
            let state = await multicall.getRig(rigAddr, user1.address);
            expect(state.epochId).to.equal(0);
            // Fresh rig's initial miner is the launcher
            const initialMiner = await rig.epochMiner();
            expect(initialMiner).to.equal(user0.address);

            // 3. First user mines via Multicall
            let epochId = await rig.epochId();
            let price = await rig.getPrice();
            let deadline = await getFutureDeadline();

            await multicall.connect(user1).mine(
                rigAddr,
                epochId,
                deadline,
                price.mul(2),
                "First miner",
                { value: price.mul(2) }
            );

            // 4. Verify state updated
            state = await multicall.getRig(rigAddr, user1.address);
            expect(state.miner).to.equal(user1.address);
            expect(state.epochUri).to.equal("First miner");

            // 5. Wait and let tokens accumulate
            await increaseTime(300);

            // 6. Second user mines, first user gets tokens
            epochId = await rig.epochId();
            price = await rig.getPrice();
            deadline = await getFutureDeadline();

            const user1TokensBefore = await unit.balanceOf(user1.address);

            await multicall.connect(user2).mine(
                rigAddr,
                epochId,
                deadline,
                price.mul(2),
                "Second miner",
                { value: price.mul(2) }
            );

            const user1TokensAfter = await unit.balanceOf(user1.address);
            expect(user1TokensAfter).to.be.gt(user1TokensBefore);

            // 7. Verify updated state via Multicall
            state = await multicall.getRig(rigAddr, user1.address);
            expect(state.miner).to.equal(user2.address);
            expect(state.unitBalance).to.equal(user1TokensAfter);

            // 8. Check auction state via Multicall
            const auctionState = await multicall.getAuction(rigAddr, user1.address);
            expect(auctionState.wethAccumulated).to.be.gt(0);
        });

        it("Multiple users mining same rig via Multicall", async function () {
            // Launch rig
            const launchParams = {
                launcher: AddressZero,
                tokenName: "Multi User Test",
                tokenSymbol: "MULTI",
                uri: "",
                donutAmount: convert("300", 18),
                unitAmount: convert("1000000", 18),
                initialUps: convert("50", 18),
                tailUps: convert("0.5", 18),
                halvingPeriod: 86400,
                rigEpochPeriod: 600,
                rigPriceMultiplier: convert("1.2", 18),
                rigMinInitPrice: convert("0.00001", 18),
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 3600,
                auctionPriceMultiplier: convert("1.1", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await donut.connect(user0).approve(multicall.address, launchParams.donutAmount);
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();
            const launchEvent = await parseLaunchEvent(receipt);
            const rigAddr = launchEvent.args.rig;
            const unitAddr = launchEvent.args.unit;
            const rig = await ethers.getContractAt("Rig", rigAddr);
            const unit = await ethers.getContractAt("Unit", unitAddr);

            const users = [user0, user1, user2, user3];

            // Each user mines in sequence
            for (let i = 0; i < 10; i++) {
                const user = users[i % users.length];
                const epochId = await rig.epochId();
                const price = await rig.getPrice();
                const deadline = await getFutureDeadline();

                await multicall.connect(user).mine(
                    rigAddr,
                    epochId,
                    deadline,
                    price.add(convert("1", 18)),
                    `Mine ${i}`,
                    { value: price.add(convert("1", 18)) }
                );

                // Small delay between mines
                await increaseTime(60);
            }

            // Verify all users earned tokens (except user3 who mined last)
            for (const user of [user0, user1, user2]) {
                const balance = await unit.balanceOf(user.address);
                expect(balance).to.be.gt(0);
            }
        });

        it("Frontend simulation: check state -> mine -> check state", async function () {
            // Launch rig
            const launchParams = {
                launcher: AddressZero,
                tokenName: "Frontend Sim",
                tokenSymbol: "FRONT",
                uri: "",
                donutAmount: convert("200", 18),
                unitAmount: convert("1000000", 18),
                initialUps: convert("10", 18),
                tailUps: convert("0.1", 18),
                halvingPeriod: 86400,
                rigEpochPeriod: 600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 3600,
                auctionPriceMultiplier: convert("1.2", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await donut.connect(user1).approve(multicall.address, launchParams.donutAmount);
            const tx = await multicall.connect(user1).launch(launchParams);
            const receipt = await tx.wait();
            const launchEvent = await parseLaunchEvent(receipt);
            const rigAddr = launchEvent.args.rig;

            // Frontend step 1: Get rig state to display
            const initialState = await multicall.getRig(rigAddr, user2.address);

            console.log("    Initial State:");
            console.log(`      Epoch: ${initialState.epochId}`);
            console.log(`      Price: ${divDec(initialState.price)} ETH`);
            console.log(`      UPS: ${divDec(initialState.ups)}`);
            console.log(`      User ETH: ${divDec(initialState.ethBalance)}`);

            // Frontend step 2: User decides to mine
            const rig = await ethers.getContractAt("Rig", rigAddr);
            const epochId = initialState.epochId;
            const price = initialState.price;
            const deadline = await getFutureDeadline();

            await multicall.connect(user2).mine(
                rigAddr,
                epochId,
                deadline,
                price.mul(2),
                "Frontend mine",
                { value: price.mul(2) }
            );

            // Frontend step 3: Refresh state
            const afterMineState = await multicall.getRig(rigAddr, user2.address);

            console.log("    After Mine State:");
            console.log(`      Epoch: ${afterMineState.epochId}`);
            console.log(`      Miner: ${afterMineState.miner}`);
            console.log(`      Price: ${divDec(afterMineState.price)} ETH`);

            expect(afterMineState.epochId).to.equal(initialState.epochId.add(1));
            expect(afterMineState.miner).to.equal(user2.address);
        });
    });

    // ============================================================
    // EDGE CASES AND ERROR HANDLING
    // ============================================================
    describe("Edge Cases and Error Handling", function () {
        let rig, auction;

        before(async function () {
            const launchParams = {
                launcher: AddressZero,
                tokenName: "Edge Case Test",
                tokenSymbol: "EDGE",
                uri: "",
                donutAmount: convert("200", 18),
                unitAmount: convert("1000000", 18),
                initialUps: convert("5", 18),
                tailUps: convert("0.05", 18),
                halvingPeriod: 86400,
                rigEpochPeriod: 600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 3600,
                auctionPriceMultiplier: convert("1.2", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await donut.connect(user0).approve(multicall.address, launchParams.donutAmount);
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();
            const launchEvent = await parseLaunchEvent(receipt);
            rig = await ethers.getContractAt("Rig", launchEvent.args.rig);
            auction = await ethers.getContractAt("Auction", launchEvent.args.auction);
        });

        it("Mine with exact price (no excess refund)", async function () {
            const epochId = await rig.epochId();
            const price = await rig.getPrice();
            const deadline = await getFutureDeadline();

            const wethBefore = await weth.balanceOf(user1.address);

            await multicall.connect(user1).mine(
                rig.address,
                epochId,
                deadline,
                price,
                "Exact price",
                { value: price }
            );

            const wethAfter = await weth.balanceOf(user1.address);
            // Should receive minimal or no refund
            expect(wethAfter.sub(wethBefore)).to.be.lte(convert("0.0001", 18));
        });

        it("Query non-existent rig reverts", async function () {
            const fakeRig = ethers.Wallet.createRandom().address;

            await expect(
                multicall.getRig(fakeRig, user1.address)
            ).to.be.reverted;
        });

        it("Query getAuction with non-existent rig reverts", async function () {
            const fakeRig = ethers.Wallet.createRandom().address;

            await expect(
                multicall.getAuction(fakeRig, user1.address)
            ).to.be.reverted;
        });

        it("Rapid sequential mines via Multicall work correctly", async function () {
            for (let i = 0; i < 5; i++) {
                const epochId = await rig.epochId();
                const price = await rig.getPrice();
                const deadline = await getFutureDeadline();

                await multicall.connect(user1).mine(
                    rig.address,
                    epochId,
                    deadline,
                    price.add(convert("1", 18)),
                    `Rapid mine ${i}`,
                    { value: price.add(convert("1", 18)) }
                );
            }

            expect(await rig.epochMiner()).to.equal(user1.address);
        });

        it("Long URI strings work via Multicall", async function () {
            const longUri = "x".repeat(5000);
            const epochId = await rig.epochId();
            const price = await rig.getPrice();
            const deadline = await getFutureDeadline();

            await multicall.connect(user2).mine(
                rig.address,
                epochId,
                deadline,
                price.add(convert("1", 18)),
                longUri,
                { value: price.add(convert("1", 18)) }
            );

            expect(await rig.epochUri()).to.equal(longUri);
        });
    });

    // ============================================================
    // GAS ESTIMATION VIA MULTICALL
    // ============================================================
    describe("Gas Usage", function () {
        it("Launch gas cost", async function () {
            const launchParams = {
                launcher: AddressZero,
                tokenName: "Gas Test",
                tokenSymbol: "GAS",
                uri: "",
                donutAmount: convert("200", 18),
                unitAmount: convert("1000000", 18),
                initialUps: convert("1", 18),
                tailUps: convert("0.01", 18),
                halvingPeriod: 86400,
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.1", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await donut.connect(user3).approve(multicall.address, launchParams.donutAmount);
            const tx = await multicall.connect(user3).launch(launchParams);
            const receipt = await tx.wait();

            console.log(`    Launch gas used: ${receipt.gasUsed.toString()}`);
            expect(receipt.gasUsed).to.be.lt(6000000); // Reasonable limit
        });

        it("Mine gas cost", async function () {
            // Get a rig address
            const rigAddr = await core.deployedRigs(0);
            const rig = await ethers.getContractAt("Rig", rigAddr);

            const epochId = await rig.epochId();
            const price = await rig.getPrice();
            const deadline = await getFutureDeadline();

            const tx = await multicall.connect(user1).mine(
                rigAddr,
                epochId,
                deadline,
                price.add(convert("1", 18)),
                "Gas test mine",
                { value: price.add(convert("1", 18)) }
            );
            const receipt = await tx.wait();

            console.log(`    Mine gas used: ${receipt.gasUsed.toString()}`);
            expect(receipt.gasUsed).to.be.lt(500000); // Reasonable limit
        });

        it("getRig view call gas estimation", async function () {
            const rigAddr = await core.deployedRigs(0);

            // For view calls, we can estimate gas
            const gasEstimate = await multicall.estimateGas.getRig(rigAddr, user1.address);
            console.log(`    getRig estimated gas: ${gasEstimate.toString()}`);
        });

        it("getAuction view call gas estimation", async function () {
            const rigAddr = await core.deployedRigs(0);

            const gasEstimate = await multicall.estimateGas.getAuction(rigAddr, user1.address);
            console.log(`    getAuction estimated gas: ${gasEstimate.toString()}`);
        });
    });
});
