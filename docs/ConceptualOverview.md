0) Identity

- We built Franchiser as a way to start new community tokens on Base without flash grabs or removable liquidity. It is a launch-and-mine machine where people compete for a rotating “miner” seat instead of buying big chunks up front.
- Franchiser fits into the Donut ecosystem by pairing every new token with DONUT from day one and routing mining payments back through DONUT-linked liquidity. This keeps the broader system focused on strengthening DONUT as the common store of value and gives DonutDAO more DONUT-centric activity to govern.
- GlazeCorp designed and maintains Franchiser; DonutDAO sets the broader mission. We do not own the tokens that launch here, and once a launch is configured the rules run on their own.

1) The core idea

- Picture an always-on conveyor belt of newly minted tokens. Only one wallet at a time sits in the driver’s seat to collect what the belt produces. That seat can be claimed by anyone willing to pay the current asking price, which falls over time like a silent auction.
- Key concepts:
  - Rotating seat: the right to harvest emissions passes to whoever buys the seat most recently.
  - Falling price clock: each round starts expensive and slides toward free, so waiting is rewarded but risks someone else moving first.
  - Emission meter: tokens come off the line at a steady rate that halves on a schedule until it hits a floor.
  - Reward recycling: when the seat changes hands, most of the payment goes to the prior sitter, and a slice goes to a treasury sale that burns liquidity pool receipts.
  - Locked pool: the initial trading pool for the new token and DONUT is created and the pool receipts are sent to an unreachable address, so that liquidity cannot be pulled.

2) Why this exists

- Traditional token launches can be dominated by fast bots that grab large allocations before ordinary people have a chance. Fixed-price sales also make it hard to discover fair pricing.
- Franchiser replaces “buy once, hold forever” with “earn while you hold the seat,” so speed offers no advantage and patience can pay off. Prices start high and drift down, so there is no jackpot for racing ahead of others.
- The guiding principle is continuous price discovery through time-weighted participation: people are paid for how long they secure the seat, not how fast they click.

3) The cast of characters

- Launchers: they bring DONUT to seed the first trading pool, set emission and timing parameters, and receive ownership of the mining setup. They also start as the initial seat holder.
- Miners: anyone who competes for the seat to earn the new token and a payout from whoever replaces them.
- Liquidity providers: people who add new liquidity to the token/DONUT pair and receive pool receipts; they can later spend those receipts in treasury sales.
- Treasury buyers: anyone holding pool receipts who wants the accumulated mining payments (held in wrapped ETH) and is willing to burn their receipts to get them.
- Protocol stewards: whichever party controls the platform’s owner settings (such as protocol fee receiver or launch requirements). We cannot confirm who holds that role in any live deployment from this repository alone.

4) The system loop

- A launcher locks in configuration, seeds the DONUT trading pool, and starts the conveyor belt with themselves in the seat.
- Time passes; the asking price for the seat ticks down. Someone pays it to take the seat.
- At the moment of takeover, the outgoing sitter is paid: they receive all the tokens their time earned plus most of the incoming payment. Treasury, team, and protocol slices are carved out automatically.
- A new round starts immediately with a refreshed asking price (linked to what was just paid) and the same emission schedule.
- Meanwhile, treasury slices pile up. Anyone with pool receipts can burn them in a separate falling-price sale to claim that pile.
- The cycle repeats as long as people keep challenging for the seat or buying from the treasury sale.

5) Incentives and value flow

- Paying for the seat: the challenger sends wrapped ETH. About 80% goes to the previous sitter, 15% goes to the treasury sale pot, 4% goes to the launcher’s chosen team wallet if one is set, and 1% goes to the platform’s protocol wallet if enabled. If a team or protocol wallet is unset, their share folds into the treasury slice.
- Earning from time: the sitter accrues the new token at the set emission rate for as long as they hold the seat; payout happens when someone else replaces them.
- Treasury sale: the treasury pot (held in wrapped ETH) can be bought by burning pool receipts. The sale price also falls over time and resets based on the last purchase.
- Liquidity: the initial pool receipts are unrecoverable, so the base liquidity cannot be withdrawn. Burning receipts in the treasury sale shrinks circulating receipt supply, concentrating the pool for those who keep providing it.

6) The rules of the system

- Allowed:
  - Anyone can challenge for the seat when the price looks right to them.
  - Anyone with pool receipts can join a treasury sale round.
  - The launcher (as owner) can swap out the treasury wallet, update the team wallet (or disable that slice), and refresh the token’s metadata link.
  - The platform owner can change the protocol fee receiver and the minimum DONUT needed to launch.
- Enforced automatically:
  - Seat prices always decay linearly toward zero each round.
  - Emissions follow the configured halving schedule and never drop below the floor rate.
  - Initial liquidity pool receipts cannot be reclaimed.
  - Minting goes only to the current sitter and only according to time held.
- Not possible within this system:
  - Changing emission speed, halving timing, or price decay settings after launch.
  - Pulling out the initial liquidity.
  - Minting extra tokens outside the seat rotation flow.

7) A concrete walkthrough (with numbers)

- Setup: A launcher seeds 10,000 DONUT into the first pool and sets the emission to 4 tokens per second with a minimum of 0.01 after halvings. The first seat price starts at 1.0 wrapped ETH and slides to 0 over one hour. The launcher keeps the 4% team share active; protocol share is on.
- Minute 0: The launcher sits in the seat automatically. Price is 1.0. No one challenges yet.
- Minute 30: The price has fallen to roughly 0.5. Bob decides to take over and pays 0.50 wrapped ETH.
  - Payout to launcher: 80% of 0.50 = 0.40 wrapped ETH, plus their accrued tokens: 30 minutes × 60 seconds × 4 = 7,200 tokens.
  - Treasury pot: 15% of 0.50 = 0.075 wrapped ETH.
  - Team share: 4% of 0.50 = 0.02 wrapped ETH (to the launcher’s team wallet).
  - Protocol share: 1% of 0.50 = 0.005 wrapped ETH.
- Minute 70: The new round started higher again because Bob paid 0.50. The asking price has decayed to about 0.25. Carol jumps in at 0.25.
  - Payout to Bob: 80% of 0.25 = 0.20 wrapped ETH, plus his earned tokens: 40 minutes × 60 seconds × 4 = 9,600 tokens.
  - Treasury adds another 0.0375 wrapped ETH; team and protocol slices scale accordingly.
- Later: Treasury now holds roughly 0.1125 wrapped ETH. A liquidity provider holding pool receipts buys the pot during its own falling-price window by burning receipts. The wrapped ETH goes to that buyer; the burned receipts reduce circulating supply.

8) What this solves (and what it does not)

- Solves:
  - Spreads token access over time instead of rewarding the fastest bots.
  - Keeps base liquidity in place so newcomers can always trade.
  - Ties miner payments to later treasury sales that reward liquidity providers and shrink pool receipt supply.
- Does not solve:
  - Price volatility; the token’s market price can still swing.
  - Guaranteeing profit for miners or liquidity providers.
  - Preventing low activity; if no one challenges the seat, emission payouts wait until someone eventually does.
  - Any off-chain risks such as compromised wallets or phishing.
- This is NOT:
  - A fixed-yield product.
  - A promise of governance power beyond what each launch configures.
  - A guarantee that emissions will stop on a schedule; they continue at least at the configured floor until challengers stop arriving.

9) Power, incentives, and trust

- Influence:
  - Launchers choose emission settings, timing, and initial wallets for treasury and team payments. They keep the ability to redirect treasury and team destinations and metadata after launch.
  - The platform owner can switch where the protocol fee goes and how much DONUT is needed to create a new launch.
  - Miners and treasury buyers drive day-to-day outcomes through their timing choices.
- Trust surface:
  - Participants rely on the programmatic rules to split payments and enforce price decay; those rules are fixed once a launch begins.
  - Human decisions remain in wallet routing (treasury, team, protocol) and in choosing when to challenge or buy.
  - Incentives reduce trust needs: previous sitters are rewarded when someone replaces them, so they want healthy competition; liquidity providers are rewarded when treasury pots are bought and receipts are burned, so they want active trading.

10) What keeps this system honest

- Rewarded behaviors:
  - Challenging at fair prices keeps emissions circulating and pays the outgoing sitter.
  - Adding liquidity and later burning receipts aligns with treasury buyers who want the accumulated payments.
  - Letting prices decay before bidding discourages panic racing.
- Discouraged behaviors:
  - Rushing in immediately is costly because early prices are highest.
  - Trying to pause emissions or claw back liquidity is impossible within the rules.
- If people act selfishly:
  - A bidder can wait for a lower price, but risks being outbid by someone willing to pay more to move sooner.
  - A sitter might hold the seat without updating metadata or team wallet, but can’t change emissions or pull liquidity.
- If participation slows or stops:
  - Seat prices decay to zero, so the next challenger can step in for free and restart payouts.
  - Treasury pots simply sit until a pool-receipt holder decides the price is right to buy them.

11) FAQ

1. Who builds and maintains this?  
   We at GlazeCorp built and maintain it for the Donut ecosystem.

2. What do I need to launch a token here?  
   You need DONUT to seed the first trading pool and to choose emission and timing settings.

3. What happens to that initial liquidity?  
   The pool receipts are sent to an unreachable address, so the liquidity stays in place.

4. How do I earn the new token?  
   Hold the mining seat; you accrue tokens over time and get paid when someone else takes the seat from you.

5. How is the seat price set?  
   Each round starts at a high asking price and slides toward zero over a fixed period.

6. Where does my payment go when I take the seat?  
   Most goes to the previous sitter, with slices to treasury, team, and protocol wallets as configured.

7. What if no one replaces me?  
   Your accrued tokens are waiting; they pay out when someone eventually challenges you. If no one ever does, they remain unclaimed.

8. Who controls the treasury pot?  
   No one directly; it accumulates automatically and anyone with pool receipts can buy it during its own falling-price sale.

9. Can the emission speed change later?  
   No. Once launched, the emission schedule and price mechanics stay fixed.

10. Can the launcher still influence things?  
   Yes. They can change the treasury wallet, the team wallet (or turn that slice off), and the metadata link, but not the emission or pricing rules.

11. How does this support DONUT?  
   Every launch pairs the new token with DONUT, and treasury sales burn pool receipts tied to that pair, concentrating liquidity around DONUT.

12. What risks should I remember?  
   Prices can move, takeovers can be costly if badly timed, and slow participation means payouts wait until someone else acts.

12) Glossary

- Asking price: The current cost to take the mining seat; it drops steadily until someone pays it.
- Burning pool receipts: Sending liquidity pool tokens to an address that cannot use them, shrinking circulating supply.
- Conveyor belt: Metaphor for the nonstop stream of new tokens produced over time.
- DONUT: The Base-native token used to seed and anchor every launch on this platform.
- Emission rate: How many new tokens the seat produces per second.
- Emission floor: The minimum emission rate after all scheduled halvings.
- Halving schedule: A timetable that cuts the emission rate in half at set intervals.
- Initial liquidity: The first pool pairing the new token with DONUT; its receipts are made unreachable.
- Launch configuration: The set of emission, pricing, and timing choices set before a launch begins.
- Liquidity pool receipts: Proof of providing liquidity to the token/DONUT pair; they can be burned in treasury sales.
- Mining seat: The temporary right to collect newly produced tokens until someone else takes over.
- Payment slices: The automatic split of a seat purchase among the previous sitter, treasury pot, team wallet, and protocol wallet.
- Protocol wallet: An address that can receive a small cut of seat payments if enabled by the platform owner.
- Seat round: One full cycle from when a sitter holds the seat until someone else takes it.
- Team wallet: An address chosen by the launcher to receive a small cut of seat payments; it can be turned off.
- Treasury pot: The pile of wrapped ETH collected from seat takeovers, later sold in its own auction.
- Treasury sale: A falling-price sale where someone burns pool receipts to claim the treasury pot.
- Unreachable address: A destination that no one controls; used here to lock the first pool receipts.
- Wrapped ETH: The token used to pay for seat takeovers and stored in the treasury pot.
