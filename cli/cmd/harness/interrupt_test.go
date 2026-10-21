package main

import (
	"os"
	"syscall"
	"testing"
	"time"
)

// Ctrl-C runs the registered cleanups (terminal echo, lock) before the process exits with 130.
func TestInterruptRunsCleanupsBeforeExit(t *testing.T) {
	exited := make(chan int, 1)
	realExit := exit
	exit = func(code int) { exited <- code }
	defer func() { exit = realExit }()

	var ran []string
	removeA := atInterrupt(func() { ran = append(ran, "a") })
	removeB := atInterrupt(func() { ran = append(ran, "b") })
	removeA()
	defer removeB()

	if err := syscall.Kill(os.Getpid(), syscall.SIGINT); err != nil {
		t.Fatal(err)
	}
	select {
	case code := <-exited:
		if code != 130 {
			t.Fatalf("exit code = %d, want 130", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("SIGINT did not reach the handler")
	}
	if len(ran) != 1 || ran[0] != "b" {
		t.Fatalf("cleanups run = %v, want only b (a was removed)", ran)
	}
}
