# Corei3 - judge presentation and acceptance checklist

## Opening (15 seconds)

"Corei3 demonstrates three layers of fault tolerance: majority voting, an
independent watchdog, and SPI-readable fault telemetry. This is actual C and
Verilog simulation, and we cross-check the C and HDL voting results."

## Guided demo (about 3 minutes)

Click Launch mission demo and advance the nine steps:

1. **Normal:** input 10 becomes 00001010 in all three paths. Voted and protected
   output are both 10; C and HDL match.
2. **Single fault:** A bit 0 flips to 11; B/C stay 10. Majority still outputs 10.
   "We mask the effect at the output; we do not repair A."
3. **Two faults:** A/B become 11. Raw majority is wrong. Level 2 alone passes 11;
   independent-reference parity in Level 3 detects the odd-bit error and forces 0.
4. **SPI evidence:** STATUS reports 0x2D: safe mode, integrity latch,
   disagreement and parity fault. The value came through a bit-serial HDL read.
5. **Processor hang:** reset, stop heartbeat, advance 64 ticks. Both watchdog
   supervisors select safe output 0 using the independent watchdog clock.
6. **Telemetry during hang:** SPI still responds. STATUS=0x03: timeout + safe mode.
7. **No premature recovery:** restarting heartbeat does not clear the sticky latch.
8. **Show an honest limitation:** reset, then A=B=9/C=10. Wrong majority has the
   same parity, so hardware misses it. Our test oracle labels UNDETECTED ERROR.
9. **Controlled reset:** restore valid paths, heartbeat and protected output 10.

Then click Run all verification suites. Show 7,180 / 6,932 / 31 passed checks.
Click Export evidence to retain reproducible session results.

## Manual acceptance tests

Start a new session or use controlled reset between independent scenarios.
Input is 10 except where noted. Wait for the busy indicator to disappear.

| Action | Expected result |
|---|---|
| New session | A=B=C=10, output 10, NOMINAL, C/HDL MATCHED |
| Single bit A | A=11, B=C=10, vote/output 10, correction events +1 |
| Click A bit 0 again | A returns to 10; no disagreement |
| Single bit B / C | Single selected path becomes 11; vote remains 10 |
| 4 bits A | A=5, B=C=10; voted 10 |
| Split faults | A=11/B=8/C=10; voted 10, ambiguity flag set |
| Wrong majority | Raw vote 11; Level 2 output 11; Level 3 output 0 and latched safe |
| Clear faults after wrong majority | Vote 10; Level 3 remains safe/output 0 |
| Controlled reset | Both outputs 10, hardware history/counters cleared |
| Silent TMR fault | A=B=C=11; no disagreement but parity alarm and safe mode |
| Parity blind spot after reset | A=B=9/C=10; vote/output 9; UNDETECTED ERROR |
| Stop heartbeat, advance 64 ticks | Both safe; elapsed saturates at 64 |
| Read STATUS during hang | 0x00000003; SPI remains responsive |
| Resume heartbeat after timeout | Both remain safe until controlled reset |
| External integrity alarm | Both enter safe mode; removing alarm alone does not recover |
| Input 0, 1, 255 after reset | All healthy paths/output equal the decimal input |
| Read all via SPI while healthy | ID=0x43334933; path snapshot=0x0A0A0A0A for input 10 |
| Run verification | All three suites show PASS |
| Export evidence | Nonempty JSON with actions, states, SPI reads and test output |
| New session | Clears session counters/log and returns to healthy input 10 |

## Questions judges may ask

**Why not just duplicate the computation twice?** Two disagreeing values do not
provide a majority. Three copies can mask a fault confined to one path.

**Does majority voting detect every two-path fault?** No. Two paths sharing the
same wrong bit can win the vote. Disagreement alone cannot identify the truth.

**Is the watchdog physically independent?** RTL uses a separate watchdog-clock
input; simulation keeps it active while heartbeat stops. A board implementation
must provide a genuinely independent clock source and appropriate reset circuitry.

**Can parity find all corruptions?** No. Odd-bit output changes are detected
relative to a valid reference; even-bit changes can preserve parity. The trusted
reference and multi-bit interface coherence are explicit integration assumptions.

**Do you recover corrupted memory?** No. We demonstrate fault masking, safe fallback
and controlled reset. Memory scrubbing and trusted software reload are future work.

**Why is safe output zero?** It is our example inactive command. A real application's
safe state must be chosen from its actuator and mission requirements.
