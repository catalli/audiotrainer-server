var fs = require('fs');
var chokidar = require('chokidar');
var csv = require('fast-csv');
var jsonfile = require('jsonfile');

var jsfft = require("jsfft");
var complex_array = require("./node_modules/jsfft/lib/complex_array.js");
var extractors = require("./node_modules/meyda/dist/node/featureExtractors.js");
var meyda_utils = require("./node_modules/meyda/dist/node/utilities.js");

var WavDecoder = require("wav-decoder");
var WavEncoder = require("wav-encoder");

var config = require('./config.json');

//getSpectrum function provided by jakubfiala, Meyda Collaborator
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

function Float32ArrayMatrix(rows, cols) {
	var ta = new Float32Array(rows*cols);
	var matrix = [];
	for (var row = 0; row < rows; row++) {
		matrix[row] = ta.subarray(row*cols, (row+1)*cols);
	}
	return matrix;
}

function createArray(length) {
    var arr = new Array(length || 0),
        i = length;

    if (arguments.length > 1) {
        var args = Array.prototype.slice.call(arguments, 1);
        while(i--) arr[length-1 - i] = createArray.apply(this, args);
    }
    return arr;
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

function smooth(graph, wl) {
	var smoothedGraph = new Array(graph.length);
	for(var i = 0;i<graph.length;i++) smoothedGraph[i] = graph[i];
	for(var i = wl;i<smoothedGraph.length-wl;i++) smoothedGraph[i] = getAvg(graph.slice(i-wl, i+wl+1));
	return smoothedGraph;
}

function movingAvg(graph, wl) {
	var avgGraph = new Array(graph.length);
	for(var i = 0;i<graph.length;i++) avgGraph[i] = graph[i];
	for(var i = 2*wl;i<avgGraph.length;i++) avgGraph[i] = getAvg(graph.slice(i-2*wl,i+1));
	return avgGraph;
}

function derivative(graph, wl) {
	var graphDerivative = new Array(graph.length);
	for(var i = wl;i<graph.length-wl;i++) graphDerivative[i] = graph[i] - graph[i-wl];
	return graphDerivative;
}

function findPeaks(graph, wl) {
	var peakArray = new Array();
	var smoothGraph = smooth(graph, wl);
	var dGraph = derivative(smoothGraph,wl);
	var dGraphAvg = movingAvg(dGraph, wl);
	var d2Graph = derivative(dGraph,wl);
	for(var i = 3*wl;i<graph.length-3*wl;i++) if((dGraph[i]>=0 && d2Graph[i]<0) && dGraphAvg[i] > 0) peakArray.push(i);
	return peakArray;
}

function movingStdDev(graph, wl) {
	var stdDevGraph = new Array(graph.length);
	for (var i = 0; i<graph.length;i++) stdDevGraph[i] = 0;
	for(var i = 2*wl;i<graph.length;i++) stdDevGraph[i] = getStdDev(graph.slice(i-2*wl,i+1));
	return stdDevGraph;
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
		
		var name = "";
		
		var flags = new Array();
		
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
		
		var datetime = "";
		var datetimenow = new Date().toISOString().replace(/T/,' ').replace(/\..+/, ' ').trim();
		
		csv
			.fromPath(path)
			.on("data", function(data) {
				name = data[0];
				datetime = data[1];
				for(var i = 2; i<data.length;i++) {
					heartrates.push(parseFloat(data[i]));
					heartratesSorted.push(parseFloat(data[i]));
					flags.push(0);
				}
			})
			.on("end", function() {
			
			var samplePeriod = config.heartratePeriod;
			
			readFile(audioPath).then(function(buffer) {
				return WavDecoder.decode(buffer);
			})
			.then(function(audioData) {
				var buffSize = audioData.sampleRate*samplePeriod;
				
				var zcrGraphAvg = createArray(Math.ceil(audioData.channelData[0].length/buffSize),n+1);
				var rmsGraphAvg = createArray(Math.ceil(audioData.channelData[0].length/buffSize),n+1);
				var energyGraphAvg = createArray(Math.ceil(audioData.channelData[0].length/buffSize),n+1);
				var spectralSlopeGraphAvg = createArray(Math.ceil(audioData.channelData[0].length/buffSize),n+1);
				var loudnessGraphAvg = createArray(Math.ceil(audioData.channelData[0].length/buffSize),n+1);
				var perceptualSpreadGraphAvg = createArray(Math.ceil(audioData.channelData[0].length/buffSize),n+1);
				var perceptualSharpnessGraphAvg = createArray(Math.ceil(audioData.channelData[0].length/buffSize),n+1);
				var mfccGraphAvg = createArray(Math.ceil(audioData.channelData[0].length/buffSize),n+1);
				
				var zcrGraphAvgSorted = createArray(Math.ceil(audioData.channelData[0].length/buffSize));
				var rmsGraphAvgSorted = createArray(Math.ceil(audioData.channelData[0].length/buffSize));
				var energyGraphAvgSorted = createArray(Math.ceil(audioData.channelData[0].length/buffSize));
				var spectralSlopeGraphAvgSorted = createArray(Math.ceil(audioData.channelData[0].length/buffSize));
				var loudnessGraphAvgSorted = createArray(Math.ceil(audioData.channelData[0].length/buffSize));
				var perceptualSpreadGraphAvgSorted = createArray(Math.ceil(audioData.channelData[0].length/buffSize));
				var perceptualSharpnessGraphAvgSorted = createArray(Math.ceil(audioData.channelData[0].length/buffSize));
				var mfccGraphAvgSorted = createArray(Math.ceil(audioData.channelData[0].length/buffSize));
				
				for (var n = 0;n<audioData.channelData.length;n++) {
					var zcrGraph = new Array();
					var rmsGraph = new Array();
					var energyGraph = new Array();
					var spectralSlopeGraph = new Array();
					var loudnessGraph = new Array();
					var perceptualSpreadGraph = new Array();
					var perceptualSharpnessGraph = new Array();
					var mfccGraph = new Array();
					
					for(var i = 0, k=0;i<audioData.channelData[n].length-buffSize;i+=buffSize, k++) {
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
						
						zcrGraphAvg[k][n] = zcrs;
						rmsGraphAvg[k][n] = rmss;
						energyGraphAvg[k][n] = energys;
						spectralSlopeGraphAvg[k][n] = spectralSlopes;
						loudnessGraphAvg[k][n] = loudnesss.total;
						perceptualSpreadGraphAvg[k][n] = perceptualSpreads;
						perceptualSharpnessGraphAvg[k][n] = perceptualSharpnesss;
						mfccGraphAvg[k][n] = getAvg(mfccs);
					}
					heartratesSorted.sort();
					heartratesSorted.reverse();
					heartrateAvg = getAvg(heartrates);
					var heartrateSmooth = smooth(heartrates, config.windowLength);
					var heartratePeaks = findPeaks(heartrates, config.windowLength);
					var heartrateThreshold = heartratesSorted[Math.ceil(heartratesSorted.length/10)];
					for(var i = 0;i < heartrates.length;i++) {
						if(heartrates[i] >= heartrateThreshold) {
							while(heartratePeaks.indexOf(i) <= -1) {
								flags[i] = 1;
								i++;
							}
							var j = i;
							while(heartrateSmooth[j] > heartrateAvg) {
								flags[j] = 1;
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
					'name':name,
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
				if(config.generateSamples) {
					for(var i = 0; i<zcrGraphAvg.length;i++) {
						zcrGraphAvg[i] = getAvg(zcrGraphAvg[i]);
						zcrGraphAvgSorted[i] = zcrGraphAvg[i];
						rmsGraphAvg[i] = getAvg(rmsGraphAvg[i]);
						rmsGraphAvgSorted[i] = rmsGraphAvg[i];
						energyGraphAvg[i] = getAvg(energyGraphAvg[i]);
						energyGraphAvgSorted[i] = energyGraphAvg[i];
						spectralSlopeGraphAvg[i] = getAvg(spectralSlopeGraphAvg[i]);
						spectralSlopeGraphAvgSorted[i] = spectralSlopeGraphAvg[i];
						loudnessGraphAvg[i] = getAvg(loudnessGraphAvg[i]);
						loudnessGraphAvgSorted[i] = loudnessGraphAvg[i];
						perceptualSpreadGraphAvg[i] = getAvg(perceptualSpreadGraphAvg[i]);
						perceptualSpreadGraphAvgSorted[i] = perceptualSpreadGraphAvg[i];
						perceptualSharpnessGraphAvg[i] = getAvg(perceptualSharpnessGraphAvg[i]);
						perceptualSharpnessGraphAvgSorted[i] = perceptualSharpnessGraphAvg[i];
						mfccGraphAvg[i] = getAvg(mfccGraphAvg[i]);
						mfccGraphAvgSorted[i] = mfccGraphAvg[i];
					}
					
					for (var i = 0; i<zcrGraphAvg.length;i++) {
						if (isNaN(zcrGraphAvg[i])) {
							zcrGraphAvg.splice(i,i+1);
							i--;
						}
					}
					for (var i = 0; i<rmsGraphAvg.length;i++) {
						if (isNaN(rmsGraphAvg[i])) {
							rmsGraphAvg.splice(i,i+1);
							i--;
						}
					}
					for (var i = 0; i<energyGraphAvg.length;i++) {
						if (isNaN(energyGraphAvg[i])) {
							energyGraphAvg.splice(i,i+1);
							i--;
						}
					}
					for (var i = 0; i<spectralSlopeGraphAvg.length;i++) {
						if (isNaN(spectralSlopeGraphAvg[i])) {
							spectralSlopeGraphAvg.splice(i,i+1);
							i--;
						}
					}
					for (var i = 0; i<loudnessGraphAvg.length;i++) {
						if (isNaN(loudnessGraphAvg[i])) {
							loudnessGraphAvg.splice(i,i+1);
							i--;
						}
					}
					for (var i = 0; i<perceptualSpreadGraphAvg.length;i++) {
						if (isNaN(perceptualSpreadGraphAvg[i])) {
							perceptualSpreadGraphAvg.splice(i,i+1);
							i--;
						}
					}
					for (var i = 0; i<perceptualSharpnessGraphAvg.length;i++) {
						if (isNaN(perceptualSharpnessGraphAvg[i])) {
							perceptualSharpnessGraphAvg.splice(i,i+1);
							i--;
						}
					}
					for (var i = 0; i<mfccGraphAvg.length;i++) {
						if (isNaN(mfccGraphAvg[i])) {
							mfccGraphAvg.splice(i,i+1);
							i--;
						}
					}
									
					zcrGraphAvgSorted.sort();
					zcrGraphAvgSorted.reverse();
					var zcrDev = movingStdDev(zcrGraphAvg, config.featureWindowLength);
					var zcrDevAvg = getAvg(zcrDev);
					var zcrDevSorted = new Array(zcrDev.length);
					for(var i = 0;i<zcrDev.length;i++) zcrDevSorted[i] = zcrDev[i];
					zcrDevSorted.sort();
					zcrDevSorted.reverse();
					var zcrDevThreshold = zcrDevSorted[Math.ceil(zcrDevSorted.length/10)]
					var zcrThreshold = zcrGraphAvgSorted[Math.ceil(zcrGraphAvgSorted.length/10)];
					var zcrAvg = getAvg(zcrGraphAvg);
									
					for(var i = 0; i<zcrGraphAvg.length;i++) {
						if(zcrGraphAvg[i] >= zcrThreshold || zcrDev[i] >= zcrDevThreshold) {
							while((zcrGraphAvg[i] >= zcrThreshold || zcrDev[i] >= zcrDevThreshold) && i < zcrGraphAvg.length) {
								i++;
							}
							var j = i;
							while(zcrGraphAvg[j] >= zcrAvg || zcrDev[j] >= zcrDevAvg) {
								j--;
							}
							i*=buffSize;
							j=(j-1)*buffSize;
							if(i > audioData.channelData[0].length) {
								i = audioData.channelData[0].length;
							}
							if(j < 0) {
								j = 0;
							}
							var sampleChannels = Float32ArrayMatrix(audioData.channelData.length, i-j+1);
							for(var n = 0; n<audioData.channelData.length;n++) {
								for(var m = j; m<i && m-j < i-j+1;m++) {
									sampleChannels[n][m-j] = audioData.channelData[n][m];
								}
							}
							var sampleData = {
								sampleRate: audioData.sampleRate,
								channelData: sampleChannels
							};
							WavEncoder.encode(sampleData).then(function(buffer) {
								var zcrSampleCounter = 0;
								while(1) {
									try {
										var pathStats = fs.lstatSync(config.samplePath+"zcr-"+datetimenow+"-"+zcrSampleCounter+config.fileFormat);
										if(pathStats.isFile()) zcrSampleCounter++;
									}
									catch(e) {
										fs.writeFileSync(config.samplePath+"zcr-"+datetimenow+"-"+zcrSampleCounter+config.fileFormat, buffer);
										break;
									}
								}
							});
						}
					}
					
					rmsGraphAvgSorted.sort();
					rmsGraphAvgSorted.reverse();
					var rmsDev = movingStdDev(rmsGraphAvg, config.featureWindowLength);
					var rmsDevAvg = getAvg(rmsDev);
					var rmsDevSorted = new Array(rmsDev.length);
					for(var i = 0;i<rmsDev.length;i++) rmsDevSorted[i] = rmsDev[i];
					rmsDevSorted.sort();
					rmsDevSorted.reverse();
					var rmsDevThreshold = rmsDevSorted[Math.ceil(rmsDevSorted.length/10)]
					var rmsThreshold = rmsGraphAvgSorted[Math.ceil(rmsGraphAvgSorted.length/10)];
					var rmsAvg = getAvg(rmsGraphAvg);
									
					for(var i = 0; i<rmsGraphAvg.length;i++) {
						if(rmsGraphAvg[i] >= rmsThreshold || rmsDev[i] >= rmsDevThreshold) {
							while((rmsGraphAvg[i] >= rmsThreshold || rmsDev[i] >= rmsDevThreshold) && i < rmsGraphAvg.length) {
								i++;
							}
							var j = i;
							while(rmsGraphAvg[j] >= rmsAvg || rmsDev[j] >= rmsDevAvg) {
								j--;
							}
							i*=buffSize;
							j=(j-1)*buffSize;
							if(i > audioData.channelData[0].length) {
								i = audioData.channelData[0].length;
							}
							if(j < 0) {
								j = 0;
							}
							var sampleChannels = Float32ArrayMatrix(audioData.channelData.length, i-j+1);
							for(var n = 0; n<audioData.channelData.length;n++) {
								for(var m = j; m<i && m-j < i-j+1;m++) {
									sampleChannels[n][m-j] = audioData.channelData[n][m];
								}
							}
							var sampleData = {
								sampleRate: audioData.sampleRate,
								channelData: sampleChannels
							};
							WavEncoder.encode(sampleData).then(function(buffer) {
								var rmsSampleCounter = 0;
								while(1) {
									try {
										var pathStats = fs.lstatSync(config.samplePath+"rms-"+datetimenow+"-"+rmsSampleCounter+config.fileFormat);
										if(pathStats.isFile()) rmsSampleCounter++;
									}
									catch(e) {
										fs.writeFileSync(config.samplePath+"rms-"+datetimenow+"-"+rmsSampleCounter+config.fileFormat, buffer);
										break;
									}
								}
							});
						}
					}
					
					energyGraphAvgSorted.sort();
					energyGraphAvgSorted.reverse();
					var energyDev = movingStdDev(energyGraphAvg, config.featureWindowLength);
					var energyDevAvg = getAvg(energyDev);
					var energyDevSorted = new Array(energyDev.length);
					for(var i = 0;i<energyDev.length;i++) energyDevSorted[i] = energyDev[i];
					energyDevSorted.sort();
					energyDevSorted.reverse();
					var energyDevThreshold = energyDevSorted[Math.ceil(energyDevSorted.length/10)]
					var energyThreshold = energyGraphAvgSorted[Math.ceil(energyGraphAvgSorted.length/10)];
					var energyAvg = getAvg(energyGraphAvg);
									
					for(var i = 0; i<energyGraphAvg.length;i++) {
						if(energyGraphAvg[i] >= energyThreshold || energyDev[i] >= energyDevThreshold) {
							while((energyGraphAvg[i] >= energyThreshold || energyDev[i] >= energyDevThreshold) && i < energyGraphAvg.length) {
								i++;
							}
							var j = i;
							while(energyGraphAvg[j] >= energyAvg || energyDev[j] >= energyDevAvg) {
								j--;
							}
							i*=buffSize;
							j=(j-1)*buffSize;
							if(i > audioData.channelData[0].length) {
								i = audioData.channelData[0].length;
							}
							if(j < 0) {
								j = 0;
							}
							var sampleChannels = Float32ArrayMatrix(audioData.channelData.length, i-j+1);
							for(var n = 0; n<audioData.channelData.length;n++) {
								for(var m = j; m<i && m-j < i-j+1;m++) {
									sampleChannels[n][m-j] = audioData.channelData[n][m];
								}
							}
							var sampleData = {
								sampleRate: audioData.sampleRate,
								channelData: sampleChannels
							};
							WavEncoder.encode(sampleData).then(function(buffer) {
								var energySampleCounter = 0;
								while(1) {
									try {
										var pathStats = fs.lstatSync(config.samplePath+"energy-"+datetimenow+"-"+energySampleCounter+config.fileFormat);
										if(pathStats.isFile()) energySampleCounter++;
									}
									catch(e) {
										fs.writeFileSync(config.samplePath+"energy-"+datetimenow+"-"+energySampleCounter+config.fileFormat, buffer);
										break;
									}
								}
							});
						}
					}
				
					spectralSlopeGraphAvgSorted.sort();
					spectralSlopeGraphAvgSorted.reverse();
					var spectralSlopeDev = movingStdDev(spectralSlopeGraphAvg, config.featureWindowLength);
					var spectralSlopeDevAvg = getAvg(spectralSlopeDev);
					var spectralSlopeDevSorted = new Array(spectralSlopeDev.length);
					for(var i = 0;i<spectralSlopeDev.length;i++) spectralSlopeDevSorted[i] = spectralSlopeDev[i];
					spectralSlopeDevSorted.sort();
					spectralSlopeDevSorted.reverse();
					var spectralSlopeDevThreshold = spectralSlopeDevSorted[Math.ceil(spectralSlopeDevSorted.length/10)]
					var spectralSlopeThreshold = spectralSlopeGraphAvgSorted[Math.ceil(spectralSlopeGraphAvgSorted.length/10)];
					var spectralSlopeAvg = getAvg(spectralSlopeGraphAvg);
									
					for(var i = 0; i<spectralSlopeGraphAvg.length;i++) {
						if(spectralSlopeGraphAvg[i] >= spectralSlopeThreshold || spectralSlopeDev[i] >= spectralSlopeDevThreshold) {
							while((spectralSlopeGraphAvg[i] >= spectralSlopeThreshold || spectralSlopeDev[i] >= spectralSlopeDevThreshold) && i < spectralSlopeGraphAvg.length) {
								i++;
							}
							var j = i;
							while(spectralSlopeGraphAvg[j] >= spectralSlopeAvg || spectralSlopeDev[j] >= spectralSlopeDevAvg) {
								j--;
							}
							i*=buffSize;
							j=(j-1)*buffSize;
							if(i > audioData.channelData[0].length) {
								i = audioData.channelData[0].length;
							}
							if(j < 0) {
								j = 0;
							}
							var sampleChannels = Float32ArrayMatrix(audioData.channelData.length, i-j+1);
							for(var n = 0; n<audioData.channelData.length;n++) {
								for(var m = j; m<i && m-j < i-j+1;m++) {
									sampleChannels[n][m-j] = audioData.channelData[n][m];
								}
							}
							var sampleData = {
								sampleRate: audioData.sampleRate,
								channelData: sampleChannels
							};
							WavEncoder.encode(sampleData).then(function(buffer) {
								var spectralSlopeSampleCounter = 0;
								while(1) {
									try {
										var pathStats = fs.lstatSync(config.samplePath+"spectralSlope-"+datetimenow+"-"+spectralSlopeSampleCounter+config.fileFormat);
										if(pathStats.isFile()) spectralSlopeSampleCounter++;
									}
									catch(e) {
										fs.writeFileSync(config.samplePath+"spectralSlope-"+datetimenow+"-"+spectralSlopeSampleCounter+config.fileFormat, buffer);
										break;
									}
								}
							});
						}
					}
					
					loudnessGraphAvgSorted.sort();
					loudnessGraphAvgSorted.reverse();
					var loudnessDev = movingStdDev(loudnessGraphAvg, config.featureWindowLength);
					var loudnessDevAvg = getAvg(loudnessDev);
					var loudnessDevSorted = new Array(loudnessDev.length);
					for(var i = 0;i<loudnessDev.length;i++) loudnessDevSorted[i] = loudnessDev[i];
					loudnessDevSorted.sort();
					loudnessDevSorted.reverse();
					var loudnessDevThreshold = loudnessDevSorted[Math.ceil(loudnessDevSorted.length/10)]
					var loudnessThreshold = loudnessGraphAvgSorted[Math.ceil(loudnessGraphAvgSorted.length/10)];
					var loudnessAvg = getAvg(loudnessGraphAvg);
									
					for(var i = 0; i<loudnessGraphAvg.length;i++) {
						if(loudnessGraphAvg[i] >= loudnessThreshold || loudnessDev[i] >= loudnessDevThreshold) {
							while((loudnessGraphAvg[i] >= loudnessThreshold || loudnessDev[i] >= loudnessDevThreshold) && i < loudnessGraphAvg.length) {
								i++;
							}
							var j = i;
							while(loudnessGraphAvg[j] >= loudnessAvg || loudnessDev[j] >= loudnessDevAvg) {
								j--;
							}
							i*=buffSize;
							j=(j-1)*buffSize;
							if(i > audioData.channelData[0].length) {
								i = audioData.channelData[0].length;
							}
							if(j < 0) {
								j = 0;
							}
							var sampleChannels = Float32ArrayMatrix(audioData.channelData.length, i-j+1);
							for(var n = 0; n<audioData.channelData.length;n++) {
								for(var m = j; m<i && m-j < i-j+1;m++) {
									sampleChannels[n][m-j] = audioData.channelData[n][m];
								}
							}
							var sampleData = {
								sampleRate: audioData.sampleRate,
								channelData: sampleChannels
							};
							WavEncoder.encode(sampleData).then(function(buffer) {
								var loudnessSampleCounter = 0;
								while(1) {
									try {
										var pathStats = fs.lstatSync(config.samplePath+"loudness-"+datetimenow+"-"+loudnessSampleCounter+config.fileFormat);
										if(pathStats.isFile()) loudnessSampleCounter++;
									}
									catch(e) {
										fs.writeFileSync(config.samplePath+"loudness-"+datetimenow+"-"+loudnessSampleCounter+config.fileFormat, buffer);
										break;
									}
								}
							});
						}
					}
					
					perceptualSpreadGraphAvgSorted.sort();
					perceptualSpreadGraphAvgSorted.reverse();
					var perceptualSpreadDev = movingStdDev(perceptualSpreadGraphAvg, config.featureWindowLength);
					var perceptualSpreadDevAvg = getAvg(perceptualSpreadDev);
					var perceptualSpreadDevSorted = new Array(perceptualSpreadDev.length);
					for(var i = 0;i<perceptualSpreadDev.length;i++) perceptualSpreadDevSorted[i] = perceptualSpreadDev[i];
					perceptualSpreadDevSorted.sort();
					perceptualSpreadDevSorted.reverse();
					var perceptualSpreadDevThreshold = perceptualSpreadDevSorted[Math.ceil(perceptualSpreadDevSorted.length/10)]
					var perceptualSpreadThreshold = perceptualSpreadGraphAvgSorted[Math.ceil(perceptualSpreadGraphAvgSorted.length/10)];
					var perceptualSpreadAvg = getAvg(perceptualSpreadGraphAvg);
									
					for(var i = 0; i<perceptualSpreadGraphAvg.length;i++) {
						if(perceptualSpreadGraphAvg[i] >= perceptualSpreadThreshold || perceptualSpreadDev[i] >= perceptualSpreadDevThreshold) {
							while((perceptualSpreadGraphAvg[i] >= perceptualSpreadThreshold || perceptualSpreadDev[i] >= perceptualSpreadDevThreshold) && i < perceptualSpreadGraphAvg.length) {
								i++;
							}
							var j = i;
							while(perceptualSpreadGraphAvg[j] >= perceptualSpreadAvg || perceptualSpreadDev[j] >= perceptualSpreadDevAvg) {
								j--;
							}
							i*=buffSize;
							j=(j-1)*buffSize;
							if(i > audioData.channelData[0].length) {
								i = audioData.channelData[0].length;
							}
							if(j < 0) {
								j = 0;
							}
							var sampleChannels = Float32ArrayMatrix(audioData.channelData.length, i-j+1);
							for(var n = 0; n<audioData.channelData.length;n++) {
								for(var m = j; m<i && m-j < i-j+1;m++) {
									sampleChannels[n][m-j] = audioData.channelData[n][m];
								}
							}
							var sampleData = {
								sampleRate: audioData.sampleRate,
								channelData: sampleChannels
							};
							WavEncoder.encode(sampleData).then(function(buffer) {
								var perceptualSpreadSampleCounter = 0;
								while(1) {
									try {
										var pathStats = fs.lstatSync(config.samplePath+"perceptualSpread-"+datetimenow+"-"+perceptualSpreadSampleCounter+config.fileFormat);
										if(pathStats.isFile()) perceptualSpreadSampleCounter++;
									}
									catch(e) {
										fs.writeFileSync(config.samplePath+"perceptualSpread-"+datetimenow+"-"+perceptualSpreadSampleCounter+config.fileFormat, buffer);
										break;
									}
								}
							});
						}
					}
					
					perceptualSharpnessGraphAvgSorted.sort();
					perceptualSharpnessGraphAvgSorted.reverse();
					var perceptualSharpnessDev = movingStdDev(perceptualSharpnessGraphAvg, config.featureWindowLength);
					var perceptualSharpnessDevAvg = getAvg(perceptualSharpnessDev);
					var perceptualSharpnessDevSorted = new Array(perceptualSharpnessDev.length);
					for(var i = 0;i<perceptualSharpnessDev.length;i++) perceptualSharpnessDevSorted[i] = perceptualSharpnessDev[i];
					perceptualSharpnessDevSorted.sort();
					perceptualSharpnessDevSorted.reverse();
					var perceptualSharpnessDevThreshold = perceptualSharpnessDevSorted[Math.ceil(perceptualSharpnessDevSorted.length/10)]
					var perceptualSharpnessThreshold = perceptualSharpnessGraphAvgSorted[Math.ceil(perceptualSharpnessGraphAvgSorted.length/10)];
					var perceptualSharpnessAvg = getAvg(perceptualSharpnessGraphAvg);
									
					for(var i = 0; i<perceptualSharpnessGraphAvg.length;i++) {
						if(perceptualSharpnessGraphAvg[i] >= perceptualSharpnessThreshold || perceptualSharpnessDev[i] >= perceptualSharpnessDevThreshold) {
							while((perceptualSharpnessGraphAvg[i] >= perceptualSharpnessThreshold || perceptualSharpnessDev[i] >= perceptualSharpnessDevThreshold) && i < perceptualSharpnessGraphAvg.length) {
								i++;
							}
							var j = i;
							while(perceptualSharpnessGraphAvg[j] >= perceptualSharpnessAvg || perceptualSharpnessDev[j] >= perceptualSharpnessDevAvg) {
								j--;
							}
							i*=buffSize;
							j=(j-1)*buffSize;
							if(i > audioData.channelData[0].length) {
								i = audioData.channelData[0].length;
							}
							if(j < 0) {
								j = 0;
							}
							var sampleChannels = Float32ArrayMatrix(audioData.channelData.length, i-j+1);
							for(var n = 0; n<audioData.channelData.length;n++) {
								for(var m = j; m<i && m-j < i-j+1;m++) {
									sampleChannels[n][m-j] = audioData.channelData[n][m];
								}
							}
							var sampleData = {
								sampleRate: audioData.sampleRate,
								channelData: sampleChannels
							};
							WavEncoder.encode(sampleData).then(function(buffer) {
								var perceptualSharpnessSampleCounter = 0;
								while(1) {
									try {
										var pathStats = fs.lstatSync(config.samplePath+"perceptualSharpness-"+datetimenow+"-"+perceptualSharpnessSampleCounter+config.fileFormat);
										if(pathStats.isFile()) perceptualSharpnessSampleCounter++;
									}
									catch(e) {
										fs.writeFileSync(config.samplePath+"perceptualSharpness-"+datetimenow+"-"+perceptualSharpnessSampleCounter+config.fileFormat, buffer);
										break;
									}
								}
							});
						}
					}
					
					mfccGraphAvgSorted.sort();
					mfccGraphAvgSorted.reverse();
					var mfccDev = movingStdDev(mfccGraphAvg, config.featureWindowLength);
					var mfccDevAvg = getAvg(mfccDev);
					var mfccDevSorted = new Array(mfccDev.length);
					for(var i = 0;i<mfccDev.length;i++) mfccDevSorted[i] = mfccDev[i];
					mfccDevSorted.sort();
					mfccDevSorted.reverse();
					var mfccDevThreshold = mfccDevSorted[Math.ceil(mfccDevSorted.length/10)]
					var mfccThreshold = mfccGraphAvgSorted[Math.ceil(mfccGraphAvgSorted.length/10)];
					var mfccAvg = getAvg(mfccGraphAvg);
									
					for(var i = 0; i<mfccGraphAvg.length;i++) {
						if(mfccGraphAvg[i] >= mfccThreshold || mfccDev[i] >= mfccDevThreshold) {
							while((mfccGraphAvg[i] >= mfccThreshold || mfccDev[i] >= mfccDevThreshold) && i < mfccGraphAvg.length) {
								i++;
							}
							var j = i;
							while(mfccGraphAvg[j] >= mfccAvg || mfccDev[j] >= mfccDevAvg) {
								j--;
							}
							i*=buffSize;
							j=(j-1)*buffSize;
							if(i > audioData.channelData[0].length) {
								i = audioData.channelData[0].length;
							}
							if(j < 0) {
								j = 0;
							}
							var sampleChannels = Float32ArrayMatrix(audioData.channelData.length, i-j+1);
							for(var n = 0; n<audioData.channelData.length;n++) {
								for(var m = j; m<i && m-j < i-j+1;m++) {
									sampleChannels[n][m-j] = audioData.channelData[n][m];
								}
							}
							var sampleData = {
								sampleRate: audioData.sampleRate,
								channelData: sampleChannels
							};
							WavEncoder.encode(sampleData).then(function(buffer) {
								var mfccSampleCounter = 0;
								while(1) {
									try {
										var pathStats = fs.lstatSync(config.samplePath+"mfcc-"+datetimenow+"-"+mfccSampleCounter+config.fileFormat);
										if(pathStats.isFile()) mfccSampleCounter++;
									}
									catch(e) {
										fs.writeFileSync(config.samplePath+"mfcc-"+datetimenow+"-"+mfccSampleCounter+config.fileFormat, buffer);
										break;
									}
								}
							});
						}
					}
				}
				if(config.testing) {
					var times = new Array(heartrates.length);
					for(var i = 0;i<times.length;i++) times[i] = (i*config.heartratePeriod).toString();
					for(var i = 0;i<heartrates.length;i++) heartrates[i] = (heartrates[i]).toString();
					for(var i = 0;i<zcrGraph.length;i++) zcrGraph[i] = (zcrGraph[i]).toString();
					for(var i = 0;i<rmsGraph.length;i++) rmsGraph[i] = (rmsGraph[i]).toString();
					for(var i = 0;i<energyGraph.length;i++) energyGraph[i] = (energyGraph[i]).toString();
					for(var i = 0;i<spectralSlopeGraph.length;i++) spectralSlopeGraph[i] = (spectralSlopeGraph[i]).toString();
					for(var i = 0;i<loudnessGraph.length;i++) loudnessGraph[i] = (loudnessGraph[i]).toString();
					for(var i = 0;i<perceptualSpreadGraph.length;i++) perceptualSpreadGraph[i] = (perceptualSpreadGraph[i]).toString();
					for(var i = 0;i<perceptualSharpnessGraph.length;i++) perceptualSharpnessGraph[i] = (perceptualSharpnessGraph[i]).toString();
					for(var i = 0;i<mfccGraph.length;i++) mfccGraph[i] = (mfccGraph[i]).toString();
					for(var i = 0;i<flags.length;i++) flags[i] = (flags[i]).toString();
					var csvStream = csv.createWriteStream({headers:true, quoteHeaders:true}), 
						writableStream = fs.createWriteStream(config.testPath+"debug-"+fileName);
					writableStream.on("finish", function() {
						console.log("Debug data at: "+config.testPath+"debug-"+fileName);
					});
					csvStream.pipe(writableStream);
					for(i=0;i<times.length;i++) {
						csvStream.write({
							time:times[i],
							heartrate:heartrates[i],
							flag:flags[i],
							zcr:zcrGraph[i],
							rms:rmsGraph[i],
							energy:energyGraph[i],
							spectralSlope:spectralSlopeGraph[i],
							loudness:loudnessGraph[i],
							perceptualSpread:perceptualSpreadGraph[i],
							perceptualSharpness:perceptualSharpnessGraph[i],
							mfcc:mfccGraph[i]
						});
					}
					csvStream.end();
				}	
			});
		});
	}
});