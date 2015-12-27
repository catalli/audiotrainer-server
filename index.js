var fs = require('fs');
var chokidar = require('chokidar');
var csv = require('fast-csv');
var jsonfile = require('jsonfile');

var jsfft = require("jsfft");
var complex_array = require("./node_modules/jsfft/lib/complex_array.js");
var extractors = require("./node_modules/meyda/dist/node/featureExtractors.js");
var meyda_utils = require("./node_modules/meyda/dist/node/utilities.js");

var WavDecoder = require("wav-decoder");

var config = require('./config.json');

//getSpectrum function provided by jakubfiala, Meyda Developer
function getSpectrum(_d) {
    var windowedSignal = meyda_utils.applyWindow(_d, 'hanning');
    var data = new complex_array.ComplexArray(_d.length);
    data.map(function(value, i, n) {
        value.real = windowedSignal[i];
    });
    var spec = data.FFT();
    var ampSpectrum = new Float32Array(_d.length/2);
    for (var i = 0; i < _d.length/2; i++) {
        ampSpectrum[i] = Math.sqrt(Math.pow(spec.real[i],2) + Math.pow(spec.imag[i],2));
    }
    return ampSpectrum;
}

function getAvg(array) {
	var total = 0;
	for (var i = 0;i < array.length;i++) {
		total += array[i];
	}
	avg = total/array.length;
	return avg;
}

function getStdDev(array) {
	var avg = getAvg(array);
	totalDev = 0;
	for(var i = 0;i < array.length;i++) {
		totalDev += Math.pow((array[i] - avg),2)
	}
	stdDev = Math.sqrt(totalDev/(array.length-1))
	return stdDev;
}

function getCorrelation(array1, array2) {
	var avg1 = getAvg(array1);
	var avg2 = getAvg(array2);
	var stdDev1 = getStdDev(array1);
	var stdDev2 = getStdDev(array2);
	cov = 0;
	for(var i = 0;i < array1.length && i < array2.length;i++) {
		cov += (array1[i]-avg1)*(array2[i]-avg2);
	}
	cov /= array1.length;
	corr = cov/(stdDev1*stdDev2);
	return corr;
}

function getMaxIndex(array) {
	var max = array[0];
	var maxIndex = 0;
	for(var i = 1; i < array.length; i++) {
		if(array[i] > max) {
			maxIndex = i;
			max = array[i];
		}
	}
	return maxIndex;
}


var watcher = chokidar.watch(config.heartratePath, {ignored: /^\./, persistent: true});

watcher.on('add', function(path) {
	var pathSplit = path.split("/");
	var fileName = pathSplit[pathSplit.length-1];
	if(fileName[0]!=".") {
		var audioPath = config.soundPath +fileName.replace(".csv",config.fileFormat);
		var heartrates = new Array();
		var heartratesSorted = new Array();
		var increasingGraph = new Array();
		
		var zcrCorrelations = new Array();
		var rmsCorrelations = new Array();
		var energyCorrelations = new Array();
		var spectralSlopeCorrelations = new Array();
		var loudnessCorrelations = new Array();
		var perceptualSpreadCorrelations = new Array();
		var perceptualSharpnessCorrelations = new Array();
		var mfccCorrelations = new Array();
		
		var zcrGraphSlice = new Array();
		var rmsGraphSlice = new Array();
		var energyGraphSlice = new Array();
		var spectralSlopeGraphSlice = new Array();
		var loudnessGraphSlice = new Array();
		var perceptualSpreadGraphSlice = new Array();
		var perceptualSharpnessGraphSlice = new Array();
		var mfccGraphSlice = new Array();
		
		var zcrPoints = 0;
		var rmsPoints = 0;
		var energyPoints = 0;
		var spectralSlopePoints = 0;
		var loudnessPoints = 0;
		var perceptualSpreadPoints = 0;
		var perceptualSharpnessPoints = 0;
		var mfccPoints = 0;
		
		var readFile = function(filepath) {
			return new Promise(function(resolve, reject) {
				fs.readFile(filepath, function(err, buffer) {
					if(err) {
						return reject(err);
					}
					return resolve(buffer);
				});
			});
		};
		
		var datetime = new Date().toISOString().replace(/T/,' ').replace(/\..+/, ' ');
		csv
			.fromPath(path)
			.on("data", function(data) {
				for(var i = 0; i<data.length;i++) {
					heartrates.push(parseFloat(data[i]));
					heartratesSorted.push(parseFloat(data[i]));
				}
			})
			.on("end", function() {
			
			var samplePeriod = config.heartratePeriod;
			
			readFile(audioPath).then(function(buffer) {
				return WavDecoder.decode(buffer);
			}).then(function(audioData) {
				var buffSize = audioData.sampleRate*samplePeriod;
				for (var n = 0;n<audioData.channelData.length;n++) {
					var zcrGraph = new Array();
					var rmsGraph = new Array();
					var energyGraph = new Array();
					var spectralSlopeGraph = new Array();
					var loudnessGraph = new Array();
					var perceptualSpreadGraph = new Array();
					var perceptualSharpnessGraph = new Array();
					var mfccGraph = new Array();
					for(var i = 0;i<audioData.channelData[n].length-buffSize;i+=buffSize) {
						var sig_end = i+buffSize;
						if(sig_end > audioData.channelData[n].length) {
							sig_end = audioData.channelData[n].length;
						}	
						var my_signal = audioData.channelData[n].slice(i, sig_end);
						var buffSizeNew = my_signal.length;
						var ampSpec = getSpectrum(my_signal);
					
						var zcrs = extractors.zcr({
							signal: my_signal,
							bufferSize: buffSizeNew,
							sampleRate: audioData.sampleRate
						});
					
						var rmss = extractors.rms({
							signal: my_signal,
							bufferSize: buffSizeNew,
							sampleRate: audioData.sampleRate
						});
					
						var energys = extractors.energy({
							signal: my_signal,
							bufferSize: buffSizeNew,
							sampleRate: audioData.sampleRate
						});
					
						var spectralSlopes = extractors.spectralSlope({
							ampSpectrum: ampSpec,
							bufferSize: buffSizeNew,
							sampleRate: audioData.sampleRate
						});
										
						var loudnesss = extractors.loudness({
							ampSpectrum: ampSpec,
							barkScale: buffSizeNew,
							sampleRate: audioData.sampleRate
						});
					
						var perceptualSpreads = extractors.perceptualSpread({
							signal: my_signal,
							ampSpectrum: ampSpec,
							barkScale: buffSizeNew,
							bufferSize: buffSizeNew,
							sampleRate: audioData.sampleRate
						});
										
						var perceptualSharpnesss = extractors.perceptualSharpness({
							signal: my_signal,
							ampSpectrum: ampSpec,
							barkScale: buffSizeNew,
							bufferSize: buffSizeNew,
							sampleRate: audioData.sampleRate
						});
										
						var mfccs = extractors.mfcc({
							ampSpectrum: ampSpec,
							bufferSize: buffSizeNew,
							sampleRate: audioData.sampleRate
						});						
						zcrGraph.push(zcrs);
						rmsGraph.push(rmss);
						energyGraph.push(energys);
						spectralSlopeGraph.push(spectralSlopes);
						loudnessGraph.push(loudnesss.total);
						perceptualSpreadGraph.push(perceptualSpreads);
						perceptualSharpnessGraph.push(perceptualSharpnesss);
						mfccGraph.push(getAvg(mfccs));
					}
					heartratesSorted.sort();
					heartratesSorted.reverse();
					heartrateAvg = getAvg(heartrates);
					var heartrateThreshold = heartratesSorted[Math.ceil(heartratesSorted.length/10)];
					for(var i = 0;i < heartrates.length;i++) {
						if(heartrates[i] >= heartrateThreshold) {
							while(heartrates[i+1] > heartrates[i]) {
								i++;
							}
							var j = i;
							while(heartrates[j] > heartrateAvg) {
								j--;
							}
							increasingGraph = heartrates.slice(j, i+1);
							zcrGraphSlice = zcrGraph.slice(j, i+1);
							rmsGraphSlice = rmsGraph.slice(j, i+1);
							energyGraphSlice = energyGraph.slice(j, i+1);
							spectralSlopeGraphSlice = spectralSlopeGraph.slice(j, i+1);
							loudnessGraphSlice = loudnessGraph.slice(j, i+1);
							perceptualSpreadGraphSlice = perceptualSpreadGraph.slice(j, i+1);
							perceptualSharpnessGraphSlice = perceptualSharpnessGraph.slice(j, i+1);
							mfccGraphSlice = mfccGraph.slice(j, i+1);

							zcrCorrelations.push(getCorrelation(increasingGraph, zcrGraphSlice));
							rmsCorrelations.push(getCorrelation(increasingGraph, rmsGraphSlice));
							energyCorrelations.push(getCorrelation(increasingGraph, energyGraphSlice));
							//console.log("energyCorrelations: "+energyCorrelations);
							spectralSlopeCorrelations.push(getCorrelation(increasingGraph, spectralSlopeGraphSlice));
							loudnessCorrelations.push(getCorrelation(increasingGraph, loudnessGraphSlice));
							perceptualSpreadCorrelations.push(getCorrelation(increasingGraph, perceptualSpreadGraphSlice));
							perceptualSharpnessCorrelations.push(getCorrelation(increasingGraph, perceptualSharpnessGraphSlice));
							mfccCorrelations.push(getCorrelation(increasingGraph, mfccGraphSlice));
						
							while(heartrates[i] >= heartrateThreshold) {
								i++;
							}
						}
					}
				}
				var output = {
					'timestamp':datetime,
					
					'zcrCorrelation':null,
					'rmsCorrelation':null,
					'energyCorrelation':null,
					'spectralSlopeCorrelation':null,
					
					'loudnessCorrelation':null,
					'perceptualSpreadCorrelation':null,
					'perceptualSharpnessCorrelation':null,
					'mfccCorrelation':null,

					'zcrPts':0,
					'rmsPts':0,
					'energyPts':0,
					'spectralSlopePts':0,
					'loudnessPts':0,
					'perceptualSpreadPts':0,
					'perceptualSharpnessPts':0,
					'mfccPts':0
				};
				for (var i = 0; i<zcrCorrelations.length;i++) {
					if (isNaN(zcrCorrelations[i])) {
						zcrCorrelations.splice(i,i+1);
						i--;
					}
				}
				for (var i = 0; i<rmsCorrelations.length;i++) {
					if (isNaN(rmsCorrelations[i])) {
						rmsCorrelations.splice(i,i+1);
						i--;
					}
				}
				for (var i = 0; i<energyCorrelations.length;i++) {
					if (isNaN(energyCorrelations[i])) {
						energyCorrelations.splice(i,i+1);
						i--;
					}
				}
				for (var i = 0; i<spectralSlopeCorrelations.length;i++) {
					if (isNaN(spectralSlopeCorrelations[i])) {
						spectralSlopeCorrelations.splice(i,i+1);
						i--;
					}
				}
				for (var i = 0; i<loudnessCorrelations.length;i++) {
					if (isNaN(loudnessCorrelations[i])) {
						loudnessCorrelations.splice(i,i+1);
						i--;
					}
				}
				for (var i = 0; i<perceptualSpreadCorrelations.length;i++) {
					if (isNaN(perceptualSpreadCorrelations[i])) {
						perceptualSpreadCorrelations.splice(i,i+1);
						i--;
					}
				}
				for (var i = 0; i<perceptualSharpnessCorrelations.length;i++) {
					if (isNaN(perceptualSharpnessCorrelations[i])) {
						perceptualSharpnessCorrelations.splice(i,i+1);
						i--;
					}
				}
				for (var i = 0; i<mfccCorrelations.length;i++) {
					if (isNaN(mfccCorrelations[i])) {
						mfccCorrelations.splice(i,i+1);
						i--;
					}
				}
				
				var zcrCorr = getAvg(zcrCorrelations);
				var rmsCorr = getAvg(rmsCorrelations);
				var energyCorr = getAvg(energyCorrelations);
				var spectralSlopeCorr = getAvg(spectralSlopeCorrelations);
				var loudnessCorr = getAvg(loudnessCorrelations);
				var perceptualSpreadCorr = getAvg(perceptualSpreadCorrelations);
				var perceptualSharpnessCorr = getAvg(perceptualSharpnessCorrelations);
				var mfccCorr = getAvg(mfccCorrelations);
				
				output.zcrCorrelation = zcrCorr;
				output.rmsCorrelation = rmsCorr;
				output.energyCorrelation = energyCorr;
				output.spectralSlopeCorrelation = spectralSlopeCorr;
				output.loudnessCorrelation = loudnessCorr;
				output.perceptualSpreadCorrelation = perceptualSpreadCorr;
				output.perceptualSharpnessCorrelation = perceptualSharpnessCorr;
				output.mfccCorrelation = mfccCorr;
				
				var correlations = [zcrCorr, rmsCorr, energyCorr, spectralSlopeCorr, loudnessCorr, perceptualSpreadCorr, perceptualSharpnessCorr, mfccCorr];
				for (var i = 3; i >= 1; i--) {
					var maxIndex = getMaxIndex(correlations);
					switch(maxIndex) {
						case 0:
							zcrPoints += i;
							break;
						case 1:
							rmsPoints += i;
							break;
						case 2:
							energyPoints += i;
							break;
						case 3:
							spectralSlopePoints += i;
							break;
						case 4:
							loudnessPoints += i;
							break;
						case 5:
							perceptualSpreadPoints += i;
							break;
						case 6:
							perceptualSharpnessPoints += i;
							break;
						case 7:
							mfccPoints += i;
							break;
					}
					correlations[maxIndex] = -1000;
				}
				output.zcrPts = zcrPoints;
				output.rmsPts = rmsPoints;
				output.energyPts = energyPoints;
				output.spectralSlopePts = spectralSlopePoints;
				output.loudnessPts = loudnessPoints;
				output.perceptualSpreadPts = perceptualSpreadPoints;
				output.perceptualSharpnessPts = perceptualSharpnessPoints;
				output.mfccPts = mfccPoints;
				var outputFile = config.outputPath + datetime + '.json';
				jsonfile.writeFile(outputFile, output, function(err) {
					console.error(err);
				});
			});
		});
	}
});