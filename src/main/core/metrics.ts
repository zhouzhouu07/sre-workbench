export const metricsCommand = `set -eu
first=$(awk '/^cpu / {sum=0; for(i=2;i<=9;i++)sum+=$i; print sum, $5+$6; exit}' /proc/stat)
sleep 1
second=$(awk '/^cpu / {sum=0; for(i=2;i<=9;i++)sum+=$i; print sum, $5+$6; exit}' /proc/stat)
cpu=$(printf '%s %s' "$first" "$second" | awk '{d=$3-$1; if(d>0) printf "%.2f",100*(1-($4-$2)/d);else print 0}')
mem=$(awk '/MemTotal:/ {total=$2} /MemAvailable:/ {available=$2} END {printf "%.2f,%.2f",total/1024,(total-available)/1024}' /proc/meminfo)
disk=$(df -Pk / | awk 'NR==2 {printf "%.2f,%.2f",$2/1048576,$3/1048576}')
load=$(awk '{print $1}' /proc/loadavg)
net=$(awk 'NR>2 {gsub(/:/," "); if($1!="lo") {rx+=$2;tx+=$10}} END {printf "%.0f,%.0f",rx,tx}' /proc/net/dev)
printf '%s %s %s %s %s' "$cpu" "$mem" "$disk" "$load" "$net" | awk -F'[ ,]+' '{printf "{\\"cpuPercent\\":%s,\\"memoryTotalMiB\\":%s,\\"memoryUsedMiB\\":%s,\\"diskTotalGiB\\":%s,\\"diskUsedGiB\\":%s,\\"load1\\":%s,\\"networkRxBytes\\":%s,\\"networkTxBytes\\":%s}",$1,$2,$3,$4,$5,$6,$7,$8}'
`;
