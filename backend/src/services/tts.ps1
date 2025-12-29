param([string]$text, [string]$outPath)
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile($outPath)
$synth.Speak($text)
$synth.Dispose()
