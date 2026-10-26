`timescale 1ns/1ps
// wd_clk must come from a clock source independent of the protected processor.
module watchdog #(parameter TIMEOUT_CYCLES = 16)(
    input wire wd_clk,
    input wire reset_n,
    input wire heartbeat_toggle_async,
    input wire integrity_fault, // synchronous to wd_clk; external integrity monitor
    output reg timeout_latched,
    output reg integrity_latched,
    output wire safe_mode,
    output reg [31:0] elapsed
);
    reg hb_meta, hb_sync, hb_seen;
    assign safe_mode = timeout_latched | integrity_latched;
    always @(posedge wd_clk or negedge reset_n) begin
        if (!reset_n) begin
            hb_meta <= 0;
            hb_sync <= 0;
            hb_seen <= 0;
            elapsed <= 0;
            timeout_latched <= 0;
            integrity_latched <= 0;
        end else begin
            hb_meta <= heartbeat_toggle_async;
            hb_sync <= hb_meta;
            hb_seen <= hb_sync;
            if (integrity_fault) integrity_latched <= 1;
            if (!timeout_latched) begin
                if (hb_sync != hb_seen) elapsed <= 0;
                else if (elapsed >= TIMEOUT_CYCLES - 1) begin
                    elapsed <= TIMEOUT_CYCLES;
                    timeout_latched <= 1;
                end else elapsed <= elapsed + 1;
            end
        end
    end
endmodule
