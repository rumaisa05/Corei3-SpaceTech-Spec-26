`timescale 1ns/1ps
module telemetry_supervisor #(parameter TIMEOUT_CYCLES=64)(
    input wire wd_clk, reset_n, heartbeat_toggle_async, integrity_fault,
    input wire [7:0] a,b,c,
    input wire expected_parity, // independent trusted reference: XOR of valid word
    input wire spi_cs_n, spi_sck, spi_mosi,
    output wire spi_miso,
    output wire [7:0] voted, protected_output,
    output wire disagreement, safe_mode,
    output wire parity_fault, no_word_majority
);
    wire timeout_latched,integrity_latched;
    wire [31:0] elapsed;
    assign parity_fault = (^voted) != expected_parity;
    assign no_word_majority = (a!=b) && (b!=c) && (a!=c);
    supervisor #(.TIMEOUT_CYCLES(TIMEOUT_CYCLES)) core(
        .wd_clk(wd_clk),.reset_n(reset_n),
        .heartbeat_toggle_async(heartbeat_toggle_async),
        .integrity_fault(integrity_fault | parity_fault),
        .a(a),.b(b),.c(c),.voted(voted),.protected_output(protected_output),
        .disagreement(disagreement),.safe_mode(safe_mode),
        .timeout_latched(timeout_latched),.integrity_latched(integrity_latched),
        .elapsed(elapsed)
    );
    reg [31:0] mismatch_events, parity_events, ambiguous_events;
    reg [7:0] sticky_flags;
    reg prev_mismatch,prev_parity,prev_ambiguous;
    always @(posedge wd_clk or negedge reset_n) begin
        if(!reset_n) begin
            mismatch_events<=0;parity_events<=0;ambiguous_events<=0;
            sticky_flags<=0;prev_mismatch<=0;prev_parity<=0;prev_ambiguous<=0;
        end else begin
            prev_mismatch<=disagreement;prev_parity<=parity_fault;
            prev_ambiguous<=no_word_majority;
            sticky_flags<=sticky_flags | {2'b0,integrity_fault,parity_fault,
                         no_word_majority,disagreement,integrity_latched,timeout_latched};
            if(disagreement && !prev_mismatch && mismatch_events!=32'hffffffff)
                mismatch_events<=mismatch_events+1;
            if(parity_fault && !prev_parity && parity_events!=32'hffffffff)
                parity_events<=parity_events+1;
            if(no_word_majority && !prev_ambiguous && ambiguous_events!=32'hffffffff)
                ambiguous_events<=ambiguous_events+1;
        end
    end
    wire [7:0] register_address;
    reg [31:0] register_data;
    always @* begin
        case(register_address)
            8'h00:register_data=32'h43334933; // C3I3 identification
            8'h04:register_data={24'b0,1'b0,integrity_fault,parity_fault,
                   no_word_majority,disagreement,integrity_latched,timeout_latched,safe_mode};
            8'h08:register_data=mismatch_events;
            8'h0c:register_data=parity_events;
            8'h10:register_data=ambiguous_events;
            8'h14:register_data={c,b,a,voted};
            8'h18:register_data={24'b0,protected_output};
            8'h1c:register_data=elapsed;
            8'h20:register_data={24'b0,sticky_flags};
            8'h24:register_data=TIMEOUT_CYCLES;
            8'h28:register_data=32'h00010000;
            default:register_data=32'hdeadbeef;
        endcase
    end
    spi_register_reader spi(
        .clk(wd_clk),.reset_n(reset_n),.spi_cs_n(spi_cs_n),
        .spi_sck(spi_sck),.spi_mosi(spi_mosi),.spi_miso(spi_miso),
        .register_address(register_address),.register_data(register_data)
    );
endmodule
