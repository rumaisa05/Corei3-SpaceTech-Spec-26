`timescale 1ns/1ps
// Mode 0, MSB first. Eight address bits, then 32 response bits. Read only.
// Synchronize and oversample SPI in the watchdog domain: no generated clocks.
module spi_register_reader(
    input wire clk, reset_n,
    input wire spi_cs_n, spi_sck, spi_mosi,
    input wire [31:0] register_data,
    output wire [7:0] register_address,
    output wire spi_miso
);
    reg [2:0] cs_pipe, sck_pipe;
    reg [1:0] mosi_pipe;
    reg [7:0] address_shift;
    reg [31:0] response;
    reg [5:0] bit_count;
    wire rising = sck_pipe[1] & ~sck_pipe[2];
    wire falling = ~sck_pipe[1] & sck_pipe[2];
    assign register_address = {address_shift[6:0],mosi_pipe[1]};
    // Inactive slave releases the bus; active data changes only on falling SCK.
    assign spi_miso = spi_cs_n ? 1'bz :
                      ((bit_count >= 8 && bit_count <= 40) ? response[31] : 1'b0);
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            cs_pipe<=3'b111;sck_pipe<=0;mosi_pipe<=0;
            address_shift<=0;response<=0;bit_count<=0;
        end else begin
            cs_pipe<={cs_pipe[1:0],spi_cs_n};
            sck_pipe<={sck_pipe[1:0],spi_sck};
            mosi_pipe<={mosi_pipe[0],spi_mosi};
            if(cs_pipe[2]) begin
                bit_count<=0;address_shift<=0;response<=0;
            end else if(rising && bit_count < 40) begin
                bit_count<=bit_count+1;
                if(bit_count<8) begin
                    address_shift<={address_shift[6:0],mosi_pipe[1]};
                    if(bit_count==7) response<=register_data;
                end
            end else if(falling && bit_count>8 && bit_count<40)
                response<={response[30:0],1'b0};
        end
    end
endmodule
