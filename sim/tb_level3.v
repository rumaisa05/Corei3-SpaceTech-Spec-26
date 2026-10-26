`timescale 1ns/1ps
module tb_level3;
    reg clk=0; always #5 clk=~clk;
    reg reset_n=0,hb=0,integrity=0,parity=0;
    reg heartbeat_enable=1;
    integer hb_count=0;
    always @(negedge clk) begin
        if(!reset_n) begin hb<=0;hb_count<=0;end
        else if(heartbeat_enable) begin
            if(hb_count==4) begin hb<=~hb;hb_count<=0;end
            else hb_count<=hb_count+1;
        end
    end
    reg [7:0] a=10,b=10,c=10;
    reg cs=1,sck=0,mosi=0;
    wire miso;
    wire [7:0] voted,protected_output;
    wire disagreement,safe_mode,parity_fault,no_word_majority;
    integer checks=0,failures=0,i;
    reg [31:0] data;
    telemetry_supervisor #(.TIMEOUT_CYCLES(64)) dut(
        .wd_clk(clk),.reset_n(reset_n),.heartbeat_toggle_async(hb),
        .integrity_fault(integrity),.expected_parity(parity),.a(a),.b(b),.c(c),
        .spi_cs_n(cs),.spi_sck(sck),.spi_mosi(mosi),.spi_miso(miso),
        .voted(voted),.protected_output(protected_output),
        .disagreement(disagreement),.safe_mode(safe_mode),
        .parity_fault(parity_fault),.no_word_majority(no_word_majority)
    );
    task check;input condition;input [511:0] text_label;
        begin checks=checks+1;if(condition!==1'b1)begin
            failures=failures+1;$display("FAIL: %0s",text_label);end end
    endtask
    task ticks;input integer n;integer j;
        begin for(j=0;j<n;j=j+1)begin @(posedge clk);#1;end end
    endtask
    task reset_system;
        begin @(negedge clk);reset_n=0;heartbeat_enable=1;
            a=10;b=10;c=10;parity=0;integrity=0;cs=1;sck=0;
            ticks(3);@(negedge clk);reset_n=1;ticks(6);end
    endtask
    task spi_bit;input tx;output rx;
        begin mosi=tx;#80;sck=1;#40;rx=miso;#40;sck=0;#80;end
    endtask
    task read_reg;input [7:0] address;output [31:0] value;
        integer j;reg rx;
        begin cs=0;sck=0;#100;
            for(j=7;j>=0;j=j-1)spi_bit(address[j],rx);
            for(j=31;j>=0;j=j-1)begin spi_bit(0,rx);value[j]=rx;end
            cs=1;#100;
        end
    endtask
    initial begin
        $dumpfile("level3.vcd");$dumpvars(0,tb_level3);
        reset_system;
        check(miso===1'bz,"MISO inactive high impedance");
        read_reg(0,data);check(data==32'h43334933,"SPI identification");
        read_reg(4,data);check(data==0,"healthy status");
        read_reg(8,data);check(data==0,"initial counters");
        read_reg(8'h24,data);check(data==64,"timeout configuration");
        read_reg(8'h28,data);check(data==32'h10000,"interface version");
        read_reg(8'hff,data);check(data==32'hdeadbeef,"invalid address");
        @(negedge clk);a=11;ticks(3);
        check(voted==10 && !safe_mode,"single-path fault masked");
        read_reg(4,data);check(data[3] && !data[0],"SPI correctable disagreement status");
        read_reg(8,data);check(data==1,"mismatch event counted once");
        read_reg(8,data);check(data==1,"persistent fault does not recount");
        read_reg(8'h14,data);check(data==32'h0a0a0b0a,"path snapshot packing");
        @(negedge clk);a=10;ticks(3);@(negedge clk);a=11;ticks(3);
        read_reg(8,data);check(data==2,"new mismatch episode counted");
        // Two paths flip the same bit. Independent parity detects bad majority.
        @(negedge clk);b=11;ticks(3);
        check(voted==11 && parity_fault && safe_mode,"wrong majority parity alarm");
        read_reg(4,data);check(data[5] && data[2] && data[0],"fault readable over SPI");
        read_reg(8'h0c,data);check(data==1,"parity episode counter");
        read_reg(8'h18,data);check(data==0,"SPI confirms safe fallback");
        @(negedge clk);a=10;b=10;ticks(3);
        check(safe_mode,"fault removal alone does not clear safety latch");
        read_reg(8'h20,data);check(data[4] && data[1],"historical flags retained");
        reset_system;
        // All words different, but bitwise voting correct: uncertainty, not proof.
        @(negedge clk);a=11;b=8;ticks(3);
        check(no_word_majority && voted==10 && !safe_mode,"all-different can still vote correctly");
        read_reg(8'h10,data);check(data==1,"no-word-majority count");
        reset_system;
        @(negedge clk);a=11;b=11;c=11;ticks(3);
        check(!disagreement && parity_fault && safe_mode,"common odd-bit corruption detected");
        reset_system;
        @(negedge clk);a=9;b=9;c=10;ticks(3);
        check(voted==9 && !parity_fault && !safe_mode,"documented even-bit parity blind spot");
        reset_system;
        @(negedge clk);heartbeat_enable=0;ticks(70);
        check(safe_mode,"processor hang fallback");
        read_reg(4,data);check(data[1] && data[0],"timeout readable through SPI during hang");
        read_reg(8'h1c,data);check(data==64,"elapsed counter saturation");
        reset_system;
        @(negedge clk);integrity=1;ticks(3);
        read_reg(4,data);check(data[6] && data[2] && data[0],"external corruption alarm telemetry");
        reset_system;
        // Abort an incomplete command then verify framing reinitializes.
        cs=0;#100;mosi=1;#80;sck=1;#80;sck=0;#80;cs=1;#100;
        read_reg(0,data);check(data==32'h43334933,"aborted frame recovery");
        // Snapshot remains fixed even when path values change after address.
        cs=0;#100;
        for(i=7;i>=0;i=i-1)begin
            mosi=(8'h14>>i)&1;#80;sck=1;#80;sck=0;#80;
        end
        @(negedge clk);a=12;b=12;c=12;parity=0;
        for(i=31;i>=0;i=i-1)begin mosi=0;#80;sck=1;#40;data[i]=miso;#40;sck=0;#80;end
        cs=1;#100;
        check(data==32'h0a0a0a0a,"atomic per-register snapshot");
        reset_system;
        read_reg(8'h20,data);check(data==0,"reset clears telemetry history");
        check(!safe_mode && protected_output==10,"reset restores operation");
        $display("Level 3 checks: %0d | Failures: %0d",checks,failures);
        if(failures)$fatal(1,"Level 3 verification failed");
        $display("PASS: SPI telemetry + fault reporting + supervisor");$finish;
    end
endmodule
