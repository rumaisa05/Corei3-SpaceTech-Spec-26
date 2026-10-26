`timescale 1ns/1ps
module tb_supervisor;
    reg wd_clk = 0;
    always #5 wd_clk = ~wd_clk;
    reg reset_n = 0, heartbeat = 0, integrity_fault = 0;
    reg [7:0] a = 10, b = 10, c = 10;
    wire [7:0] voted, protected_output;
    wire disagreement, safe_mode, timeout_latched, integrity_latched;
    wire [31:0] elapsed;
    integer checks = 0;
    integer failures = 0;
    integer value, path, bit_index, mask;
    supervisor #(.TIMEOUT_CYCLES(16)) dut(
        .wd_clk(wd_clk), .reset_n(reset_n),
        .heartbeat_toggle_async(heartbeat), .integrity_fault(integrity_fault),
        .a(a), .b(b), .c(c), .voted(voted), .protected_output(protected_output),
        .disagreement(disagreement), .safe_mode(safe_mode),
        .timeout_latched(timeout_latched), .integrity_latched(integrity_latched),
        .elapsed(elapsed)
    );
    task check;
        input condition;
        input [511:0] label_text;
        begin
            checks = checks + 1;
            if (condition !== 1'b1) begin
                failures = failures + 1;
                $display("FAIL: %0s at %0t", label_text, $time);
            end
        end
    endtask
    task ticks;
        input integer count;
        integer i;
        begin for (i=0; i<count; i=i+1) begin @(posedge wd_clk); #1; end end
    endtask
    task reset_system;
        begin
            @(negedge wd_clk); reset_n = 0; heartbeat = 0; integrity_fault = 0;
            a=10; b=10; c=10;
            ticks(2);
            @(negedge wd_clk); reset_n=1;
        end
    endtask
    task pulse_heartbeat;
        begin @(negedge wd_clk); heartbeat = ~heartbeat; ticks(5); end
    endtask
    initial begin
        $dumpfile("level2.vcd");
        $dumpvars(0, tb_supervisor);
        reset_system;
        check(protected_output==10 && !safe_mode, "healthy output");
        // Exhaustive single-bit injections: all inputs, paths, bit positions.
        for(value=0;value<256;value=value+1)
            for(path=0;path<3;path=path+1)
                for(bit_index=0;bit_index<8;bit_index=bit_index+1) begin
                    a=value; b=value; c=value;
                    case(path)
                        0:a=value^(1<<bit_index);
                        1:b=value^(1<<bit_index);
                        2:c=value^(1<<bit_index);
                    endcase
                    #0.001;
                    check(voted==value && disagreement, "single-bit masking");
                end
        for(path=0;path<3;path=path+1)
            for(mask=1;mask<256;mask=mask+1) begin
                a=10;b=10;c=10;
                case(path) 0:a=10^mask; 1:b=10^mask; 2:c=10^mask; endcase
                #0.001;
                check(voted==10 && disagreement,"multi-bit one-path masking");
            end
        a=11;b=8;c=10;#1;
        check(voted==10,"different-bit two-path correction");
        a=11;b=11;c=10;#1;
        check(voted==11 && disagreement,"wrong majority is a TMR limitation");
        a=11;b=11;c=11;#1;
        check(voted==11 && !disagreement,"common corruption is silent");
        a=10;b=10;c=10;
        repeat(8) begin pulse_heartbeat;check(!safe_mode,"healthy heartbeat prevents timeout");end
        // Last heartbeat fully passed through synchronizer; stop processor updates.
        ticks(16);
        check(timeout_latched && safe_mode,"hang causes autonomous timeout");
        check(protected_output==0,"safe mode forces zero output");
        pulse_heartbeat;
        check(safe_mode,"heartbeat restart does not clear sticky safety state");
        reset_system;
        check(!safe_mode && protected_output==10,"controlled reset restores operation");
        // Stuck-high heartbeat is not progress and must time out.
        @(negedge wd_clk);heartbeat=1;
        ticks(4);check(!safe_mode,"initial heartbeat edge accepted");
        ticks(16);check(timeout_latched && safe_mode,"stuck-high heartbeat times out");
        reset_system;
        ticks(15);check(!safe_mode && elapsed==15,"no early timeout");
        ticks(1);check(safe_mode && elapsed==16,"exact timeout boundary");
        reset_system;
        @(negedge wd_clk);integrity_fault=1;
        ticks(1);
        check(integrity_latched && safe_mode && !timeout_latched,
              "external corruption alarm triggers safe mode");
        @(negedge wd_clk);integrity_fault=0;
        pulse_heartbeat;
        check(safe_mode,"integrity alarm remains latched");
        reset_system;
        check(!safe_mode && protected_output==10,"reset recovers from integrity event");
        $display("Checks: %0d | Failures: %0d",checks,failures);
        if(failures) $fatal(1,"Level 2 verification failed");
        $display("PASS: Level 2 TMR + independent watchdog + safe mode");
        $finish;
    end
endmodule
