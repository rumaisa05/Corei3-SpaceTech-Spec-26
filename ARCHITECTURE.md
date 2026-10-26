# Technical architecture - Corei3 radiation-mitigation supervisor

## Data flow

Three coherent path words -> bitwise TMR voter -> protected-output mux.
Independent watchdog and integrity/parity alarms -> sticky safe-mode control.
Direct signal status, counters and history -> register decoder -> SPI reader.

TMR: `voted = (a & b) | (a & c) | (b & c)`.
Safe mode forces protected_output to 0; raw voted remains visible for diagnosis.
Zero represents an example inactive command, not a universal spacecraft safe state.
There is no autonomous restart, memory scrubbing, or repaired-path claim.

## Top-level pins: telemetry_supervisor

| Name | Direction | Width | Definition |
|---|---|---:|---|
| wd_clk | input | 1 | Free-running clock independent of protected processor |
| reset_n | input | 1 | Active-low reset; clears counters and sticky safety |
| heartbeat_toggle_async | input | 1 | Toggle after useful completed processor work |
| integrity_fault | input | 1 | External corruption alarm, synchronous to wd_clk |
| a, b, c | input | 8 each | Coherent redundant computation-path values |
| expected_parity | input | 1 | Trusted independent XOR parity of valid output |
| spi_cs_n | input | 1 | Active-low SPI chip select |
| spi_sck | input | 1 | Mode 0 serial clock, idle low |
| spi_mosi | input | 1 | Master sends address MSB first |
| spi_miso | output | 1 | Serial response; high impedance when CS inactive |
| voted | output | 8 | Raw majority result |
| protected_output | output | 8 | Raw majority or zero in safe mode |
| disagreement | output | 1 | Not all path words equal |
| safe_mode | output | 1 | Latched timeout or integrity alarm |
| parity_fault | output | 1 | Raw voted parity differs from expected_parity |
| no_word_majority | output | 1 | All three complete words differ |

TIMEOUT_CYCLES defaults to 64; use an integer from 1 through 2^31-1.
Reset assertion is asynchronous. In physical integration, release reset through
a wd_clk-domain reset synchronizer/controller. The board must supply an actual
independent watchdog clock. The model proves behavior with heartbeat absent,
not physical clock independence or radiation tolerance.

## Fault interpretation

Disagreement is an observable fact, not proof the voted answer is correct.
The no_word_majority flag is an uncertainty indicator: bitwise voting can still
be correct when all three whole words differ. It does not automatically assert safe mode.

The independent parity reference provides a concrete check for wrong-majority
odd-bit corruption, including two paths flipping the same bit. expected_parity
must come from a trustworthy independently protected source, not be calculated
from voted. In the testbench it comes from the known healthy input. No general
reference-generation or memory-integrity engine is claimed in the RTL.
If the reference is corrupted too, detection can fail. Even numbers of wrong
output bits can preserve parity. Neither TMR nor this parity check guarantees
detection of every multi-path fault. CRC/ECC or application plausibility checks
could improve coverage but are outside this implementation.

integrity_fault is for an external monitor; the implementation does not scan
memory. Either external alarm or parity fault sets integrity_latched.
A watchdog cannot detect wrong data when valid progress continues.

## SPI protocol

Read-only custom register protocol, standard Mode 0 electrical timing:
CPOL=0, CPHA=0, MSB first. Assert CS low with SCK low; transmit one 8-bit byte
address. Then transmit 32 dummy zero bits while reading the 32-bit response.
Deassert CS after the response. There is one address/response per CS frame.
No command prefix, burst transfer, auto-increment, or write is supported.
Unmapped/misaligned byte addresses return 0xDEADBEEF.

The response snapshots one complete 32-bit register at the final address bit.
Changes during the response do not tear that register. Multiple separate reads
are not a global atomic snapshot. Historical flags preserve transient events.
Aborted frames are discarded when CS deassertion is observed.

SPI inputs are oversampled/synchronized in wd_clk, not used as generated clocks.
Require SCK high and low periods of at least 8 wd_clk periods; hold CS low at
least 8 periods before the first rising SCK, and high at least 8 periods between
frames. MOSI must be stable at least 4 wd_clk periods before each rising edge
and held through that edge. This limits SCK to wd_clk/16 or slower. MISO becomes
valid after synchronization delay following a falling edge; sample it at the
next rising edge. The testbench uses a slower compliant clock.
MISO tri-state is intended for a top-level FPGA output buffer; implement the
appropriate I/O primitive or separate data/enable signals on a target device.

## Register map (all read only)

| Byte address | Register | Value/definition |
|---|---|---|
| 0x00 | ID | 0x43334933 |
| 0x04 | STATUS | Current flags, see below |
| 0x08 | MISMATCH_EVENTS | Rising disagreement episodes |
| 0x0C | PARITY_EVENTS | Rising voted-parity-error episodes |
| 0x10 | AMBIGUOUS_EVENTS | Rising no-word-majority episodes |
| 0x14 | PATH_SNAPSHOT | [31:24] C, [23:16] B, [15:8] A, [7:0] voted |
| 0x18 | PROTECTED_OUTPUT | Protected value in bits [7:0] |
| 0x1C | ELAPSED | Watchdog ticks, saturating at timeout |
| 0x20 | HISTORY | Sticky historical flags, see below |
| 0x24 | TIMEOUT | Configured TIMEOUT_CYCLES |
| 0x28 | VERSION | 0x00010000 (interface v1.0) |

STATUS: bit 0 safe_mode; bit 1 timeout_latched; bit 2 integrity_latched;
bit 3 disagreement; bit 4 no_word_majority; bit 5 parity_fault;
bit 6 external integrity_fault; bit 7 and bits [31:8] reserved zero.

HISTORY: bit 0 timeout observed; bit 1 integrity latch observed;
bit 2 disagreement observed; bit 3 no-word-majority observed;
bit 4 parity fault observed; bit 5 external integrity alarm observed;
remaining bits zero. Latch-derived history can lag current status by one wd_clk
tick. Current status remains available immediately after the core updates.

Event counters count rising episodes, not elapsed faulty cycles or confirmed
corrections. They saturate at 0xFFFFFFFF. A fault that stays asserted counts
once; deassertion followed by assertion counts again. All clear on reset_n.
There is no ground-truth corrected-error counter in hardware.

## Integration assumptions and verification

Path words and parity must be coherent and stable around wd_clk sampling.
They are not individually synchronized multi-bit clock-domain buses. A real
processor integration must supply a stable sampled interface/handshake.
Heartbeat uses a two-flop synchronizer and must toggle slowly enough to be
observed. Timeout margin must exceed heartbeat period, CDC delay and tolerance.
No heartbeat resumes can clear the sticky safe state; only controlled reset.

The Level 2 regression tests 6,932 checks. The Level 3 suite tests 31 assertions,
including actual bit-serial reads of ID, status, counters, output, snapshots,
history, version, invalid addresses, timeout while SPI remains responsive,
parity detection, its even-bit blind spot, CS abort recovery and atomic response.
This is functional RTL simulation; synthesis, FPGA timing closure, board tests,
and radiation qualification have not been performed.
