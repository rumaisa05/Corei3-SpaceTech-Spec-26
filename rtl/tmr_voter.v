`timescale 1ns/1ps
module tmr_voter #(parameter WIDTH = 8)(
    input wire [WIDTH-1:0] a, b, c,
    output wire [WIDTH-1:0] voted,
    output wire disagreement
);
    assign voted = (a & b) | (a & c) | (b & c);
    assign disagreement = (a != b) | (b != c);
endmodule
