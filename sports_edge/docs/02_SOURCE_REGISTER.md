# 02 — Source and permission audit — research snapshot 2026-10-12

**IMPORTANT:** Listing a resource is not authorisation to scrape, bulk download, rehost or train a model on it. Claude must inspect terms, relevant licences, quota, historical coverage, and source access from the user's environment. Track each source with VERIFIED / UNKNOWN / BLOCKED and evidence. No evasive scraping, CAPTCHA bypass, rotating IP/proxies or imitation of an authorised API.

| Source | What is actually useful | Free? | Capability/rights risks | Initial disposition |
|---|---|---|---|---|
| StatsBomb Open Data — https://github.com/hudl/open-data | JSON match events, lineups, shot locations and cards for **selected** competitions/seasons | Yes, selected open datasets | NOT complete current EPL/Europe event coverage. Check attribution, licence/scope, match availability and event definitions. | RESEARCH historical-only unless coverage proven |
| SoccerData — https://github.com/probberechts/soccerdata | An open-source Python reader for several football sources, including Understat `read_shot_events` | Package free | Open-source client licence does NOT grant permission to scrape underlying providers. Source coverage, blocking and terms may change. | CONDITIONAL |
| Understat — https://understat.com | Potential league/player shot coordinates, outcomes, timestamped events | Public site | Current coverage, player/team IDs, rate limits and acceptable automated use must be checked. The underlying dataset may not report all bookmaker-relevant SOT definitions. | UNKNOWN until lawful access verified |
| Football-Data.co.uk — https://www.football-data.co.uk/data.php | Long-run historical **match/team** corner/card/shot counts plus match outcome odds; not complete player-event odds | Free downloads advertised | Site explicitly restricts use to private individuals, **not** commercial/data-training products using automated bots/scrapers/AI. Automated ingestion or AI-based model training should be treated BLOCKED unless clarified/authorised. Even if user manually downloads a CSV, confirm permitted usage before training. | BLOCK automated/AI ingestion pending permission |
| Football-Data.org — https://www.football-data.org/pricing | Basic fixture and league information | Free tier | Current free tier shows 12 competitions, delayed fixtures/results, 10 calls/minute. Detailed cards/lineups and shot/corner statistics are **paid** options and out of scope. | FIXTURES ONLY; NOT prop feed |
| The Odds API — https://the-odds-api.com | Regional bookmaker odds and selected player-prop markets | Free starter 500 credits/month (as displayed Oct 2026) | Historical odds not free. Even though API documents football/soccer prop keys, actual leagues, regions and bookmaker offerings vary; do not claim Betway SA price support without verifying exact book key. | OPTIONAL reference; not trusted Betway SA feed |
| Betway South Africa — https://www.betway.co.za/ | Executable markets, price, rule detail, lineup-dependent markets, possible boosts | User sees prices manually | Avoid automation/scraping/login. Exact market terms, Bet Builders and accepted combination price must be manually captured. | HUMAN SOURCE OF TRUTH |
| Betway published terms — https://cdn2.betway.co.za/terms-and-conditions | General and sport/market settlement rules | Viewable | Market-specific notes can supersede general terms, change by offer; check on bet date. | REQUIRED rule source |
| Penaltyblog — https://github.com/martineastwood/penaltyblog | GOALS models, implied probability and some general football analytics | Open-source | A football *score* Poisson/Dixon-Coles model is **not** a validated shots, SOT, booking or corners model. Use only for relevant shared utilities or independent contextual research. | OPTIONAL, not prop backbone |
| Claude Code skills — https://code.claude.com/docs/en/skills | Project/personal skills; discover existing Council | Subject to Claude Code entitlement | Existing Council skill may live in ~/.claude/skills/, repo .claude/skills/, or synced skills. Never pretend it's found or run. | INSPECT INSTALLED |

## Important provenance and exact rule examples
1. Football-Data.co.uk provides historic team match stats, **not** guaranteed event/player data. Its posted automated AI usage restriction is a STOP signal for scripted training workflows. Check source's own page rather than relying on a package's licence.
2. Football-Data.org's free tier does not include detailed shots, cards and corners: do not write a connector that silently expects premium columns.
3. The Odds API markets page (https://the-odds-api.com/sports-odds-data/betting-markets.html) lists keys such as `player_shots`, `player_shots_on_target` and `player_to_receive_card` for some soccer markets. That does **not** establish these markets for Betway SA or every football match, or historic free odds availability.
4. Betway's general football rules state that only corners **taken** count, and have special rules for card counts/booking points. Published football player-market section says player bets are void if the player was not in starting lineup. **Obtain market-specific and contemporaneous rules** for shot/SOT settlement; do not generalise these rules to all markets without verifying the relevant market's offer.
5. The bookmaker account displayed to user can have different accepted prices from another region's brand. Betway UK is not Betway South Africa. Boosts may have T&C limitations and should be treated as UNKNOWN until accepted/settled.

## Data sufficiency checklist per market
For each source/competition/season/market, record:
- exact permissible access mode and terms URL, access timestamp, licence/attribution requirements
- covered teams and seasons, player identifiers, match IDs, data update lag
- shot outcomes, location coordinate definition, event deduplication, SOT definition, own goals/penalties/blocked shots
- start/substitute/bench status and minutes; quality of referee and fouls data for cards
- corners awarded vs taken, team corner attribution, extra time/stoppage treatment
- missingness %, outlier rates, conflicts between two sources, frequency of corrections
- actual bookmaker market types present and how historical **as-of** odds can be collected prospectively without automated bookmaker access.

## Practical Phase-0 recommendation
Test ONE competition and ONE market first, such as EPL player shots with legitimately usable individual events and manually entered Betway prices. If no permitted current-season player shots dataset exists, give a transparent `DATA_BLOCKED` assessment. A good no-cost research product can still save manual inputs and simulate strategies; it cannot manufacture licensed proprietary data.
