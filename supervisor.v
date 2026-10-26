`timescale 1ns/1ps
module supervisor #(
    parameter WIDTH = 8,
    parameter TIMEOUT_CYCLES = 16,
    parameter [WIDTH-1:0] SAFE_VALUE = 0
)(
    input wire wd_clk, reset_n,
    input wire heartbeat_toggle_async,
    input wire integrity_fault,
    input wire [WIDTH-1:0] a, b, c,
    output wire [WIDTH-1:0] voted, protected_output,
    output wire disagreement, safe_mode,
    output wire timeout_latched, integrity_latched,
    output wire [31:0] elapsed
);
    tmr_voter #(.WIDTH(WIDTH)) voter(
        .a(a), .b(b), .c(c), .voted(voted), .disagreement(disagreement)
    );
    watchdog #(.TIMEOUT_CYCLES(TIMEOUT_CYCLES)) wd(
        .wd_clk(wd_clk), .reset_n(reset_n),
        .heartbeat_toggle_async(heartbeat_toggle_async),
        .integrity_fault(integrity_fault),
        .timeout_latched(timeout_latched), .integrity_latched(integrity_latched),
        .safe_mode(safe_mode), .elapsed(elapsed)
    );
    assign protected_output = safe_mode ? SAFE_VALUE : voted;
endmodule
