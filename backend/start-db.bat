@echo off
rem 启动本仓库自带的 PG 实例（端口 55433，数据目录 backend\.pgdata）
rem 需要 PG 16+ 的二进制。默认用本机舆情系统自带的一套，可用 PGBIN 覆盖：
rem   set PGBIN=C:\Program Files\PostgreSQL\17\bin
setlocal
if "%PGBIN%"=="" set "PGBIN=C:\Users\Administrator\Desktop\YQ\pgsql\pgsql\bin"
"%PGBIN%\pg_ctl.exe" -D "%~dp0.pgdata" -l "%~dp0.pgdata\server.log" -o "-p 55433 -c listen_addresses=127.0.0.1" start
echo.
echo 数据目录: %~dp0.pgdata
echo 连接串  : postgresql+psycopg://miyun@127.0.0.1:55433/miyun
