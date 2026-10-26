`timescale 1ns/1ps
// Deterministic replay bridge. Commands drive real RTL and bit-serial SPI.
module tb_dashboard;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0, heartbeat_enable=1, hb=0, integrity=0;
 reg [7:0] a=10,b=10,c=10,expected=10;
 reg parity=0;
 integer hb_count=0;
 always @(negedge clk) begin
  if(!reset_n) begin hb<=0;hb_count<=0;end
  else if(heartbeat_enable) begin
   if(hb_count==4)begin hb<=~hb;hb_count<=0;end
   else hb_count<=hb_count+1;
  end
 end
 wire [7:0] v2,o2,v3,o3;
 wire mismatch2,safe2,timeout2,integrity2;
 wire mismatch3,safe3,pfault,ambiguous;
 wire [31:0] elapsed2;
 reg cs=1,sck=0,mosi=0;
 wire miso;
 supervisor #(.TIMEOUT_CYCLES(64)) l2(
  .wd_clk(clk),.reset_n(reset_n),.heartbeat_toggle_async(hb),.integrity_fault(integrity),
  .a(a),.b(b),.c(c),.voted(v2),.protected_output(o2),.disagreement(mismatch2),
  .safe_mode(safe2),.timeout_latched(timeout2),.integrity_latched(integrity2),.elapsed(elapsed2));
 telemetry_supervisor #(.TIMEOUT_CYCLES(64)) l3(
  .wd_clk(clk),.reset_n(reset_n),.heartbeat_toggle_async(hb),.integrity_fault(integrity),
  .a(a),.b(b),.c(c),.expected_parity(parity),.spi_cs_n(cs),.spi_sck(sck),
  .spi_mosi(mosi),.spi_miso(miso),.voted(v3),.protected_output(o3),
  .disagreement(mismatch3),.safe_mode(safe3),.parity_fault(pfault),.no_word_majority(ambiguous));
 integer file,rc,op,x,y,z,w,seq=0;
 reg [2047:0] command_path;
 reg [31:0] read_value=0;
 integer last_address=-1;
 task ticks;input integer count;integer j;
  begin for(j=0;j<count;j=j+1)begin @(posedge clk);#1;end end
 endtask
 task reset_system;
  begin @(negedge clk);reset_n=0;heartbeat_enable=1;integrity=0;
   a=expected;b=expected;c=expected;parity=^expected;cs=1;sck=0;
   ticks(3);@(negedge clk);reset_n=1;ticks(6);end
 endtask
 task spi_bit;input tx;output rx;
  begin mosi=tx;#80;sck=1;#40;rx=miso;#40;sck=0;#80;end
 endtask
 task read_reg;input [7:0] address;integer j;reg rx;
  begin cs=0;sck=0;#100;
   for(j=7;j>=0;j=j-1)spi_bit(address[j],rx);
   for(j=31;j>=0;j=j-1)begin spi_bit(0,rx);read_value[j]=rx;end
   cs=1;#100;last_address=address;
  end
 endtask
 task report;
  begin
   $display("RESULT {\"sequence\":%0d,\"input\":%0d,\"paths\":[%0d,%0d,%0d],\"voted\":%0d,\"l2Output\":%0d,\"l3Output\":%0d,\"l2Safe\":%0d,\"l3Safe\":%0d,\"timeout\":%0d,\"integrity2\":%0d,\"integrity3\":%0d,\"elapsed\":%0d,\"elapsed3\":%0d,\"heartbeat\":%0d,\"heartbeatEnabled\":%0d,\"mismatch\":%0d,\"parityFault\":%0d,\"ambiguous\":%0d,\"mismatchEvents\":%0d,\"parityEvents\":%0d,\"ambiguousEvents\":%0d,\"history\":%0d,\"spiAddress\":%0d,\"spiValue\":%0d,\"timePs\":%0t}",seq,expected,a,b,c,v2,o2,o3,safe2,safe3,timeout2,integrity2,l3.integrity_latched,elapsed2,l3.elapsed,hb,heartbeat_enable,mismatch2,pfault,ambiguous,l3.mismatch_events,l3.parity_events,l3.ambiguous_events,l3.sticky_flags,last_address,read_value,$time);
  end
 endtask
 initial begin
  if(!$value$plusargs("commands=%s",command_path))$fatal(1,"Missing command path");
  file=$fopen(command_path,"r");if(!file)$fatal(1,"Cannot open commands");
  reset_system;
  while(!$feof(file))begin
   rc=$fscanf(file,"%d %d %d %d %d\n",op,x,y,z,w);
   if(rc==5)begin
    case(op)
     0:begin expected=x;reset_system;end
     1:begin @(negedge clk);expected=x;parity=^expected;a=x^y;b=x^z;c=x^w;ticks(4);end
     2:ticks(x);
     3:begin @(negedge clk);heartbeat_enable=x;ticks(4);end
     4:begin @(negedge clk);integrity=x;ticks(4);end
     5:read_reg(x);
     default:$fatal(1,"Unknown bridge opcode");
    endcase
    seq=seq+1;report;
   end else if(rc!=-1)$fatal(1,"Malformed command");
  end
  $fclose(file);$finish;
 end
endmodule
