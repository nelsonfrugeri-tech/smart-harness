package localtools

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// claude-tap runs as a loopback reverse proxy between Claude Code and the gateway.
// Fixed ports keep the viewer URL stable for the front and the MCP status tool.
const (
	TapName       = "observability"
	TapProxyAddr  = "127.0.0.1:8788"
	TapViewerAddr = "127.0.0.1:8787"
	tapDatabase   = "traces.db"
	tapLog        = "claude-tap.log"
	tapStopWait   = 5 * time.Second
)

// TapProxyURL is the ANTHROPIC_BASE_URL of a Claude session routed through claude-tap.
func TapProxyURL() string { return "http://" + TapProxyAddr }

// TapViewerURL is the claude-tap live dashboard.
func TapViewerURL() string { return "http://" + TapViewerAddr }

// TracesDir keeps the trace database with this harness config, never in the project checkout.
func TracesDir(config string) string { return filepath.Join(config, "observability", "traces") }

// Listening reports whether addr accepts a TCP connection.
func Listening(addr string) bool {
	conn, err := net.DialTimeout("tcp", addr, 300*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// Tap is a running claude-tap proxy started by StartTap.
type Tap struct {
	tool   Tool
	config string
	cmd    *exec.Cmd
	exited chan struct{}
	log    *os.File
}

// StartTap starts claude-tap in proxy-only mode on loopback, forwarding to target, and
// waits until the proxy accepts connections. Request headers, including Authorization,
// pass through unchanged; claude-tap redacts them only in the stored trace.
func StartTap(config, target string, ready time.Duration) (*Tap, error) {
	tool, err := Find(TapName)
	if err != nil {
		return nil, err
	}
	if err := tool.Check(config); err != nil {
		return nil, err
	}
	if Listening(TapProxyAddr) {
		return nil, fmt.Errorf("port %s is already in use", TapProxyAddr)
	}
	dir := TracesDir(config)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, err
	}
	log, err := os.OpenFile(filepath.Join(dir, tapLog), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, err
	}
	_, proxyPort, _ := net.SplitHostPort(TapProxyAddr)
	_, viewerPort, _ := net.SplitHostPort(TapViewerAddr)
	// --tap-host keeps both proxy and dashboard on loopback; --tap-no-launch alone binds 0.0.0.0.
	// --tap-output-dir stops claude-tap from creating ./.traces in the project checkout.
	cmd := exec.Command(tool.Path(config),
		"--tap-no-launch", "--tap-host", "127.0.0.1", "--tap-port", proxyPort,
		"--tap-target", target, "--tap-live-port", viewerPort, "--tap-no-open",
		"--tap-output-dir", dir)
	cmd.Env = tool.environment(config)
	cmd.Stdout, cmd.Stderr = log, log
	// A separate process group keeps terminal Ctrl-C, which Claude Code handles, away from the proxy.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		_ = log.Close()
		return nil, fmt.Errorf("could not start claude-tap: %w", err)
	}
	tap := &Tap{tool: tool, config: config, cmd: cmd, exited: make(chan struct{}), log: log}
	go func() { _ = cmd.Wait(); close(tap.exited) }()
	deadline := time.Now().Add(ready)
	for !Listening(TapProxyAddr) {
		select {
		case <-tap.exited:
			_ = log.Close()
			return nil, fmt.Errorf("claude-tap exited during startup; see %s", log.Name())
		case <-time.After(100 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			tap.Stop()
			return nil, fmt.Errorf("claude-tap was not ready within %s; see %s", ready, log.Name())
		}
	}
	return tap, nil
}

// Stop ends the proxy and the detached dashboard it spawned. claude-tap leaves the
// dashboard running on purpose, so it is stopped with its own command.
func (t *Tap) Stop() {
	_ = t.cmd.Process.Signal(os.Interrupt)
	select {
	case <-t.exited:
	case <-time.After(tapStopWait):
		_ = t.cmd.Process.Kill()
		<-t.exited
	}
	_, viewerPort, _ := net.SplitHostPort(TapViewerAddr)
	ctx, cancel := context.WithTimeout(context.Background(), tapStopWait)
	defer cancel()
	stop := exec.CommandContext(ctx, t.tool.Path(t.config), "dashboard", "stop", "--tap-live-port", viewerPort)
	stop.Env = t.tool.environment(t.config)
	stop.Stdout, stop.Stderr = t.log, t.log
	_ = stop.Run()
	_ = t.log.Close()
}
